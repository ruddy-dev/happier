import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { storage } from '@/sync/domains/state/storage';
import { AgentStateSchema, MetadataSchema } from '@/sync/domains/state/storageTypes';
import { releaseDeskFixture } from '../deskFixtureGate';
import { getStoredCoordinatorId, setCoordinatorOverride } from '../deskPrefs';
import { resolveWaitingQuestions } from '../model/waitingQuestions';
import { applyDeskFixture } from './applyDeskFixture';

const NOW = Date.UTC(2026, 10, 1, 14, 2);
const ids = ['demo-coordinator', 'demo-weather-fix', 'demo-weather-tests', 'demo-recipe-search', 'demo-notes-export', 'demo-recipe-approval'];
function transcript(id: string) {
    return Object.values(storage.getState().sessionMessages[id]?.messagesById ?? {})
        .filter(message => message.kind === 'user-text' || message.kind === 'agent-text');
}

describe('landing demo data through the real fixture applier', () => {
    const before = storage.getState();
    beforeEach(() => storage.setState(before, true));
    afterEach(() => { releaseDeskFixture(); storage.setState(before, true); setCoordinatorOverride(null); });

    it('selects valid unique sessions, keeping three workers active and some thinking', () => {
        applyDeskFixture(NOW, 'demo');
        const sessions = Object.values(storage.getState().sessions);
        expect(sessions.map(session => session.id).sort()).toEqual([...ids].sort());
        expect(new Set(sessions.map(session => session.id)).size).toBe(ids.length);
        expect(getStoredCoordinatorId()).toBe('demo-coordinator');
        for (const session of sessions) {
            expect(MetadataSchema.safeParse(session.metadata).success).toBe(true);
            expect(AgentStateSchema.nullable().safeParse(session.agentState).success).toBe(true);
            expect(session.metadata?.homeDir).toBe('/work');
            expect(session.metadata?.path).toMatch(/^\/work(?:\/|$)/);
            expect(session.seq).toBeGreaterThan(0);
            expect(session.createdAt).toBeLessThan(session.updatedAt);
            expect(session.updatedAt).toBeLessThanOrEqual(NOW);
        }
        const workers = sessions.filter(session => session.id !== 'demo-coordinator');
        expect(workers.filter(session => session.active).length).toBeGreaterThanOrEqual(3);
        expect(workers.filter(session => session.thinking).length).toBeGreaterThanOrEqual(2);
    });

    it('ingests the bug report, fix, passing tests and example PR into the finished worker transcript', () => {
        applyDeskFixture(NOW, 'demo');
        expect(storage.getState().sessions['demo-weather-fix']?.active).toBe(false);
        const messages = transcript('demo-weather-fix');
        expect(messages[0]).toMatchObject({ kind: 'user-text' });
        const text = messages.map(message => message.text).join('\n');
        expect(text).toMatch(/forecast.*blank/i);
        expect(text).toMatch(/fix|fixed/i);
        expect(text).toMatch(/tests.*pass/i);
        expect(text).toContain('https://example.com/tiny-weather/pull/42');
        expect(storage.getState().sessionMessages['demo-weather-fix']?.isLoaded).toBe(true);
    });

    it('feeds the ordinary-question parser one single-select question with 2–4 options', () => {
        applyDeskFixture(NOW, 'demo');
        const request = Object.values(storage.getState().sessions['demo-recipe-search']?.agentState?.requests ?? {})[0];
        expect(request).toMatchObject({ tool: 'AskUserQuestion', kind: 'user_action' });
        const questions = resolveWaitingQuestions(request);
        expect(questions).toHaveLength(1);
        expect(questions?.[0]?.multiSelect).toBe(false);
        expect(questions?.[0]?.options?.length).toBeGreaterThanOrEqual(2);
        expect(questions?.[0]?.options?.length).toBeLessThanOrEqual(4);
    });

    it('has recent activity and a coordinator briefing after a break for the scripted conversation', () => {
        applyDeskFixture(NOW, 'demo');
        for (const id of ids) expect(transcript(id).length).toBeGreaterThan(0);
        const messages = transcript('demo-coordinator');
        expect(messages.some(message => message.kind === 'user-text' && /brief.*break/i.test(message.text))).toBe(true);
        expect(messages.some(message => message.kind === 'agent-text' && /pull\/42/.test(message.text) && /question/i.test(message.text))).toBe(true);
        expect(messages.some(message => message.createdAt >= NOW - 300_000)).toBe(true);
    });

    it('is deterministic, replaces datasets, and releases all transcript projections', () => {
        applyDeskFixture(NOW, 'demo');
        // Reducer-local render keys are random; wire ids, ordering, content and timestamps are stable.
        const snapshot = () => ids.map(id => ({
            session: storage.getState().sessions[id],
            messages: transcript(id).map(({ id: _renderKey, ...message }) => message),
        }));
        const first = snapshot();
        const release = applyDeskFixture(NOW, 'demo');
        expect(snapshot()).toEqual(first);
        release();
        for (const id of ids) {
            expect(storage.getState().sessions[id]).toBeUndefined();
            expect(storage.getState().sessionMessages[id]).toBeUndefined();
            expect(storage.getState().sessionListRenderables[id]).toBeUndefined();
        }
        applyDeskFixture(NOW, 'demo');
        applyDeskFixture(NOW);
        expect(Object.keys(storage.getState().sessions).some(id => id.startsWith('demo-'))).toBe(false);
        expect(getStoredCoordinatorId()).toBe('fx-coord');
    });

    it('refuses demo seeding into an account scope too', () => {
        storage.setState({ profile: { ...storage.getState().profile, id: 'account-test' } });
        expect(() => applyDeskFixture(NOW, 'demo')).toThrow('cannot run with an account');
        expect(Object.keys(storage.getState().sessions)).toHaveLength(0);
    });
});

it('ship guard: every demo data file excludes private paths, hosts, addresses and real-looking ids', () => {
    const dir = join(import.meta.dirname, 'demo');
    expect(existsSync(dir), 'the public demo has its own data directory').toBe(true);
    const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter(file => file.isFile());
    expect(files.length).toBeGreaterThan(0);
    const sessionIds: string[] = [];
    for (const file of files) {
        const content = readFileSync(join(file.parentPath, file.name), 'utf8');
        expect(content).not.toMatch(/\/home\/|\/Users\/|C:\\|ts\.net|happier\.dev/i);
        expect(content).not.toMatch(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
        expect(content).not.toMatch(/\bcm[a-z0-9]{23}\b/i);
        for (const url of content.match(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s"<>]+/gi) ?? []) {
            const parsed = new URL(url);
            expect(parsed.protocol).toBe('https:');
            expect(parsed.hostname).toBe('example.com');
            expect(parsed.username + parsed.password).toBe('');
        }
        if (file.name.endsWith('.json')) {
            const data = JSON.parse(content);
            sessionIds.push(...data.sessions.map((session: { id: string }) => session.id));
        }
    }
    expect(new Set(sessionIds).size).toBe(sessionIds.length);
});
