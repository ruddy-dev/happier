import { describe, expect, it } from 'vitest';
import { parseWqItem, parseWqProjects, wqDirectory, wqItemPath, wqStage } from './wqCardData';

describe('N1 wq card projection', () => {
    it('keeps only the four front-matter fields and ignores the body', () => {
        expect(parseWqItem('---\nid: ATR-18\ntitle: Demo: card\nstatus: review\npr: https://example.test/pull/1\nbranch: demo\n---\ntitle: Body title\nstatus: done', 'ATR-18'))
            .toEqual({ id: 'ATR-18', title: 'Demo: card', status: 'review', pr: 'https://example.test/pull/1' });
    });
    it('accepts CRLF, optional pr and long plain-text titles without retaining the body', () => {
        const title = '*demo* '.repeat(2000);
        expect(parseWqItem(`---\r\nid: ATR-18\r\ntitle: ${title}\r\nstatus: active\r\n---\r\nprivate body`, 'ATR-18'))
            .toEqual({ id: 'ATR-18', title: title.trim(), status: 'active', pr: null });
    });
    it.each([
        'id: ATR-18\ntitle: Demo\nstatus: active',
        '---\nid: ATR-18\ntitle: Demo\nstatus: active',
        '---\nid: HUB-18\ntitle: Demo\nstatus: active\n---',
        '---\ntitle: Demo\nstatus: active\n---',
        '---\nid: ATR-18\nstatus: active\n---',
        '---\nid: ATR-18\ntitle: Demo\n---',
        '---\nid: ATR-18\ntitle:\nstatus: active\n---',
    ])('F4 rejects missing, incomplete or mismatched front matter: %s', (text) => {
        expect(parseWqItem(text, 'ATR-18')).toBeNull();
    });
    it('projects only valid code/name entries, never paths or github', () => {
        const projects = parseWqProjects(JSON.stringify({
            ATR: { name: 'Desk Demo', path: '/fixture/a', github: 'example/a' },
            HUB: { name: 'Tools Demo' }, BAD: { name: 42 }, EMPTY: { name: '' },
            LONGER: { name: 'Invalid code' }, '../x': { name: 'Invalid code' }, STR: 'invalid', ARR: [],
        }));
        expect(projects).toEqual({ names: new Map([['ATR', 'Desk Demo'], ['HUB', 'Tools Demo']]), knownProjectCodes: new Set(['ATR', 'HUB']) });
    });
    it.each(['[]', 'null', '42', '"text"', '{broken'])('F4 rejects a non-object project inventory: %s', text => {
        expect(parseWqProjects(text)).toBeNull();
    });
    it.each([
        ['ready', 'plan'], ['active', 'build'], ['review', 'pr'], ['done', 'merged'],
        ['blocked', 'blocked'], ['needs-luke', 'needsYou'], ['dropped', null], ['unknown', null],
    ])('N1 maps %s only from status evidence', (status, stage) => expect(wqStage(status)).toBe(stage));
    it('N1 joins configured directories across separator styles', () => {
        expect(wqDirectory('/fixture/wq///', '/fixture/coord')).toBe('/fixture/wq');
        expect(wqDirectory('', '/fixture/coord/')).toBe('/fixture/coord/work');
        expect(wqDirectory(undefined, 'C:\\fixture\\coord\\')).toBe('C:/fixture/coord/work');
        expect(wqDirectory(undefined, null)).toBeNull();
        expect(wqDirectory('/', null)).toBe('/');
        expect(wqItemPath('/', 'ATR-18', new Set(['ATR']))).toBe('/items/ATR-18.md');
        expect(wqItemPath('/fixture/wq/', 'ATR-18', new Set(['ATR']))).toBe('/fixture/wq/items/ATR-18.md');
    });
    it.each(['../x', 'ATR-1/..', 'atr-1', 'ZZ-1', 'ATR-1234567', 'ATR-1\\x', 'ATR-1\n'])('N4 never builds an item path from %s', key => {
        expect(wqItemPath('/fixture/wq', key, new Set(['ATR', 'HUB']))).toBeNull();
    });
});
