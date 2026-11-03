import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanDeskDemo, reportDeskDemo } from './deskDemoGuard.mjs';

const scan = (dir, terms = ['jo.example']) => scanDeskDemo(dir, '/desk-demo/', terms);
// Exact public upstream samples, with identifier components kept out of literal controls.
const projectSample = '/' + 'Users/st' + 'eve/project';
const logSample = '/' + 'Users/l' + 'ee/.happier/logs/provider-installs/claude-2026-09-25.log';
const samplePaths = [
    '/' + 'home/linuxbrew/.linuxbrew/bin/claude',
    ...['src/components/Header.tsx', 'src/components/NotFound.tsx', 'package.json', 'src/utils/helpers.ts'].map(path => `${projectSample}/${path}`),
    logSample,
];
const sampleKeys = ['prompt-condition', 'prompt-state-selector', 'YOUR_DEEPSEEK_API_KEY', 'YOUR_ZAI_API_KEY', 'YOUR_OPENAI_API_KEY'].map(value => 'sk-' + value);

function fixture(run) {
    const dir = mkdtempSync(join(tmpdir(), 'demo-guard-'));
    try {
        mkdirSync(join(dir, '_expo/static/js/web'), { recursive: true });
        writeFileSync(join(dir, 'index.html'), '<script src="/desk-demo/_expo/static/js/web/entry.js"></script>');
        writeFileSync(join(dir, '_expo/static/js/web/entry.js'), 'console.log("demo");');
        run(dir);
    } finally { rmSync(dir, { recursive: true, force: true }); }
}

// Synthetic controls assembled here so private-looking literals never enter the product bundle.
const forbidden = [
    ['tailnet', 'host.' + 'ts.net'], ['loopback', '127.0.0.1:' + '3005'], ['localhost', 'localhost:' + '3005'],
    ['linux home', '/' + 'home/member.example'], ['mac home', '/' + 'Users/member.example'],
    ['windows home', 'C:' + '\\Users' + '\\member.example'], ['escaped windows home', 'C:' + '\\\\Users' + '\\\\member.example'],
    ['email', 'person@private.invalid'],
    ['posthog', 'phc_' + 'x'.repeat(40)], ['openai', 'sk-' + 'proj-' + 'a1b2'.repeat(10)],
    ['all-letter key', 'sk-' + 'a'.repeat(32)],
    ['hyphen-prefixed key', 'x-' + 'sk-' + 'a1b2'.repeat(10)],
    ['hyphen-prefixed github key', 'x-' + 'ghp_' + 'x'.repeat(36)],
    ['github', 'ghp_' + 'x'.repeat(36)], ['github pat', 'github_pat_' + 'x'.repeat(40)],
    ['aws', 'AKIA' + 'X'.repeat(16)], ['private key', '-----BEGIN RSA PRIVATE KEY-----'],
    ['inlined server', 'EXPO_PUBLIC_HAPPIER_SERVER_URL:"https://private.invalid"'],
    ['inlined non-http server', 'EXPO_PUBLIC_SERVER_URL:"wss://private.invalid"'],
    ['legacy inlined server', 'EXPO_PUBLIC_HAPPY_SERVER_URL="https://private.invalid"'],
];
for (const [label, payload] of forbidden) test(`guard rejects synthetic ${label}`, () => fixture(dir => {
    writeFileSync(join(dir, 'payload.bin'), payload);
    assert.ok(scan(dir).failures.length > 0, label);
}));

test('guard rejects configured private terms, case-insensitively, and only those', () => fixture(dir => {
    writeFileSync(join(dir, 'payload.bin'), 'by Jo.Example (jo.example)');
    assert.deepEqual(scan(dir, ['someone.example']).failures, []);
    const hits = scan(dir, ['JO.EXAMPLE', ' ']).failures;
    assert.deepEqual(hits.map(hit => [hit.rule, hit.count]), [['private term', 2]]);
    assert.deepEqual(scan(dir, ['jo.examplex']).failures, []);
}));

test('guard fails closed when the explicit term list is empty or whitespace-only', () => fixture(dir => {
    for (const terms of [[], [' ', '\t']]) {
        assert.deepEqual(scan(dir, terms).failures, [{ file: '(config)', rule: 'no private terms configured', count: 1 }]);
    }
}));

test('guard reads private terms from DESK_DEMO_PRIVATE_TERMS by default', () => fixture(dir => {
    writeFileSync(join(dir, 'payload.bin'), 'made by someone-private');
    const before = process.env.DESK_DEMO_PRIVATE_TERMS;
    try {
        process.env.DESK_DEMO_PRIVATE_TERMS = 'other, someone-private';
        assert.equal(scanDeskDemo(dir).failures.length, 1);
        delete process.env.DESK_DEMO_PRIVATE_TERMS;
        assert.deepEqual(scanDeskDemo(dir).failures, [{ file: '(config)', rule: 'no private terms configured', count: 1 }]);
        process.env.DESK_DEMO_PRIVATE_TERMS = ' , \t,';
        assert.deepEqual(scanDeskDemo(dir).failures, [{ file: '(config)', rule: 'no private terms configured', count: 1 }]);
    } finally {
        if (before === undefined) delete process.env.DESK_DEMO_PRIVATE_TERMS; else process.env.DESK_DEMO_PRIVATE_TERMS = before;
    }
}));

test('guard rejects real-looking values next to the known upstream samples', () => fixture(dir => {
    writeFileSync(join(dir, 'a.js'), 'x=' + projectSample.replace('/project', '/other.txt'));
    writeFileSync(join(dir, 'b.js'), 'x=' + '/' + 'home/linuxbrewer/x');
    writeFileSync(join(dir, 'c.js'), 'mail person@private.invalid');
    writeFileSync(join(dir, 'd.js'), 'key="' + 'sk-' + 'ant-' + 'Zz9'.repeat(8) + '"');
    writeFileSync(join(dir, 'e.js'), logSample.replace('/.happier/logs/provider-installs/claude-2026-09-25.log', '/secrets.txt'));
    const rules = scan(dir).failures.map(hit => `${hit.file}:${hit.rule}`).sort();
    assert.deepEqual(rules, ['a.js:private path', 'b.js:private path', 'c.js:non-placeholder email', 'd.js:secret', 'e.js:private path']);
}));

test('guard ignores upstream samples, placeholder keys, grammar words and media noise', () => fixture(dir => {
    writeFileSync(join(dir, 'samples.js'), [
        ...sampleKeys, ...samplePaths, 'for example: `@README.md`',
        'Licence <' + 'fer' + 'oss@fer' + 'oss.org>',
    ].join('\n'));
    writeFileSync(join(dir, 'sprite.webp'), Buffer.from('RIFF\u0000A@AY.th\u0001&C@EQ.ag', 'utf8'));
    assert.deepEqual(scan(dir).failures, []);
}));

test('guard exempts whole sample matches only', () => fixture(dir => {
    writeFileSync(join(dir, 'extended.js'), [...sampleKeys, ...samplePaths].map(value => value + '-extra').join('\n'));
    assert.deepEqual(scan(dir).failures, [
        { file: 'extended.js', rule: 'private path', count: samplePaths.length },
        { file: 'extended.js', rule: 'secret', count: sampleKeys.length },
    ]);
}));

test('guard stops sample path tokens at the specified delimiters', () => fixture(dir => {
    writeFileSync(join(dir, 'delimiters.js'), [' ', '\n', '"', "'", '`', '\\', ')', '<', '>', ',', ';'].map(end => samplePaths[0] + end + 'tail').join('\n'));
    assert.deepEqual(scan(dir).failures, []);
}));

test('guard scans printable media metadata for emails and keeps diagnostics content-free', () => fixture(dir => {
    const payload = 'person@private.invalid';
    writeFileSync(join(dir, 'metadata.png'), Buffer.from('\0Author\0' + payload + '\0', 'latin1'));
    const result = scan(dir);
    assert.deepEqual(result.failures, [{ file: 'metadata.png', rule: 'non-placeholder email', count: 1 }]);
    const output = [];
    const spies = ['error', 'warn', 'log'].map(method => mock.method(console, method, text => output.push(text)));
    try {
        reportDeskDemo(result);
        assert.ok(output.some(line => line.includes('non-placeholder email')));
        assert.ok(!JSON.stringify({ result, output }).includes(payload));
    } finally { for (const spy of spies) spy.mock.restore(); }
}));

test('guard accepts placeholders and empty endpoints, warns with host counts', () => fixture(dir => {
    writeFileSync(join(dir, 'safe.js'), 'mask-border-image-slice task-session-lifecycle package@1.2.3 demo@example.com test@example.org user@example.net EXPO_PUBLIC_HAPPIER_SERVER_URL:"" https://api.happier.dev/a https://api.happier.dev/b https://example.com/');
    const result = scan(dir);
    assert.deepEqual(result.failures, []);
    assert.equal(result.hosts['api.happier.dev'], 2);
    assert.equal(result.hosts['example.com'], 1);
}));

test('guard refuses absent, empty and incomplete exports', () => {
    assert.throws(() => scanDeskDemo('/nonexistent-demo-export'));
    const dir = mkdtempSync(join(tmpdir(), 'empty-demo-'));
    try {
        assert.throws(() => scanDeskDemo(dir));
        writeFileSync(join(dir, 'index.html'), '<script src="/desk-demo/missing.js"></script>');
        assert.throws(() => scanDeskDemo(dir));
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
