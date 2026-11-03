import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanDeskDemo } from './deskDemoGuard.mjs';

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
    ['linux home', '/' + 'home/alice'], ['mac home', '/' + 'Users/alice'],
    ['windows home', 'C:' + '\\Users' + '\\alice'], ['escaped windows home', 'C:' + '\\\\Users' + '\\\\alice'],
    ['email', 'person@private.invalid'],
    ['posthog', 'phc_' + 'x'.repeat(40)], ['openai', 'sk-' + 'proj-' + 'a1b2'.repeat(10)],
    ['github', 'ghp_' + 'x'.repeat(36)], ['github pat', 'github_pat_' + 'x'.repeat(40)],
    ['aws', 'AKIA' + 'X'.repeat(16)], ['private key', '-----BEGIN RSA PRIVATE KEY-----'],
    ['inlined server', 'EXPO_PUBLIC_HAPPIER_SERVER_URL:"https://private.invalid"'],
    ['inlined non-http server', 'EXPO_PUBLIC_SERVER_URL:"wss://private.invalid"'],
    ['legacy inlined server', 'EXPO_PUBLIC_HAPPY_SERVER_URL="https://private.invalid"'],
];
for (const [label, payload] of forbidden) test(`guard rejects synthetic ${label}`, () => fixture(dir => {
    writeFileSync(join(dir, 'payload.bin'), payload);
    assert.ok(scanDeskDemo(dir).failures.length > 0, label);
}));

test('guard rejects configured private terms, case-insensitively, and only those', () => fixture(dir => {
    writeFileSync(join(dir, 'payload.bin'), 'by Jo.Example (jo.example)');
    assert.deepEqual(scanDeskDemo(dir, '/desk-demo/', []).failures, []);
    const hits = scanDeskDemo(dir, '/desk-demo/', ['JO.EXAMPLE', ' ']).failures;
    assert.deepEqual(hits.map(hit => [hit.rule, hit.count]), [['private term', 2]]);
    assert.deepEqual(scanDeskDemo(dir, '/desk-demo/', ['jo.examplex']).failures, []);
}));

test('guard reads private terms from DESK_DEMO_PRIVATE_TERMS by default', () => fixture(dir => {
    writeFileSync(join(dir, 'payload.bin'), 'made by someone-private');
    const before = process.env.DESK_DEMO_PRIVATE_TERMS;
    try {
        process.env.DESK_DEMO_PRIVATE_TERMS = 'other, someone-private';
        assert.equal(scanDeskDemo(dir).failures.length, 1);
        delete process.env.DESK_DEMO_PRIVATE_TERMS;
        assert.equal(scanDeskDemo(dir).failures.length, 0);
    } finally {
        if (before === undefined) delete process.env.DESK_DEMO_PRIVATE_TERMS; else process.env.DESK_DEMO_PRIVATE_TERMS = before;
    }
}));

test('guard rejects real-looking values next to the known upstream samples', () => fixture(dir => {
    writeFileSync(join(dir, 'a.js'), 'x=' + '/' + 'Users/stevenson/project');
    writeFileSync(join(dir, 'b.js'), 'x=' + '/' + 'home/linuxbrewer/x');
    writeFileSync(join(dir, 'c.js'), 'mail person@private.invalid');
    writeFileSync(join(dir, 'd.js'), 'key="' + 'sk-' + 'ant-' + 'Zz9'.repeat(8) + '"');
    const rules = scanDeskDemo(dir, '/desk-demo/', []).failures.map(hit => `${hit.file}:${hit.rule}`).sort();
    assert.deepEqual(rules, ['a.js:private path', 'b.js:private path', 'c.js:non-placeholder email', 'd.js:secret']);
}));

test('guard ignores upstream samples, placeholder keys, grammar words and media noise', () => fixture(dir => {
    writeFileSync(join(dir, 'samples.js'), [
        'verilog-sk-processing-keyword', 'sk-YOUR-OPENAI-API-KEY-HERE', 'for example: `@README.md`',
        '/' + 'Users/steve/project/src/a.ts', '/' + 'Users/lee/.happier/logs/x.log', '/' + 'home/linuxbrew/.linuxbrew/bin/claude',
        'Copyright Feross Aboukhadijeh <feross@feross.org>',
    ].join('\n'));
    writeFileSync(join(dir, 'sprite.webp'), Buffer.from('RIFF\u0000A@AY.th\u0001&C@EQ.ag', 'utf8'));
    assert.deepEqual(scanDeskDemo(dir, '/desk-demo/', []).failures, []);
}));

test('guard accepts placeholders and empty endpoints, warns with host counts', () => fixture(dir => {
    writeFileSync(join(dir, 'safe.js'), 'mask-border-image-slice task-session-lifecycle package@1.2.3 demo@example.com test@example.org user@example.net EXPO_PUBLIC_HAPPIER_SERVER_URL:"" https://api.happier.dev/a https://api.happier.dev/b https://example.com/');
    const result = scanDeskDemo(dir);
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
