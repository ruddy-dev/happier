import { act } from 'react-test-renderer';
import { MMKV } from 'react-native-mmkv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { deskThemes, robotColourDefaults, robotPresets, spriteAsciiColour, spriteSignalColour, spriteStateTokens } from '../palette';
import { asciiSprites, spriteForModel, spriteGrids, type SpriteKind } from '../sprites';
import type { Bulb } from '../model/bulb';

const motion = vi.hoisted(() => ({ reduced: false, active: new Set<object>(), durations: [] as number[] }));
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock({ theme: { dark: true } });
});
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { createReducedMotionModuleMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return createReducedMotionModuleMock(() => motion.reduced);
});
// Native animation is a host boundary. Retain its elapsed-time/stop contract; real sprite logic runs.
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Animated: {
        timing: (value: { setValue: (n: number) => void }, config: { toValue: number; duration: number }) => {
            let timer: ReturnType<typeof setTimeout>;
            const handle = {};
            return {
                start: (done?: (result: { finished: boolean }) => void) => {
                    motion.active.add(handle);
                    motion.durations.push(config.duration);
                    timer = setTimeout(() => { value.setValue(config.toValue); motion.active.delete(handle); done?.({ finished: true }); }, config.duration);
                },
                stop: () => { clearTimeout(timer); motion.active.delete(handle); },
            };
        },
    } });
});

describe('WorkerSprite', () => {
    beforeEach(() => { vi.useFakeTimers(); motion.reduced = false; motion.active.clear(); motion.durations.length = 0; });
    afterEach(() => { vi.useRealTimers(); });

    it('hydrates an explicit Codex choice for every tier while preserving other providers and literal previews', async () => {
        const { WorkerSprite } = await import('./WorkerSprite');
        const pixels = (screen: Awaited<ReturnType<typeof renderScreen>>) => screen.findByTestId('ip-sprite-pixels')!.findAllByType('Rect').map(({ props }) => ({ x: props.x, y: props.y, width: props.width, height: props.height, fill: props.fill }));
        const lab = await renderScreen(<WorkerSprite kind="cxlab" bulb="idle" size={28} calm />);
        const expectedLab = pixels(lab);
        const cat = await renderScreen(<WorkerSprite kind="ragdoll" bulb="idle" size={28} calm />);
        const expectedCat = pixels(cat);
        const loupe = await renderScreen(<WorkerSprite kind="cxloupe" bulb="idle" size={28} calm />);
        const expectedLoupe = pixels(loupe);
        const prompt = await renderScreen(<WorkerSprite kind="cxprompt" bulb="idle" size={28} calm />);
        const expectedPrompt = pixels(prompt);
        new MMKV().set('ignorePrevious.codexRobot', 'lab');
        for (const model of ['gpt-6-sol', 'gpt-6-terra', 'gpt-6-astra', 'codex']) {
            const screen = await renderScreen(<WorkerSprite kind={spriteForModel(model)} bulb="idle" size={28} calm />);
            expect(pixels(screen)).toEqual(expectedLab);
        }
        const unchanged = await renderScreen(<WorkerSprite kind={spriteForModel('claude-sonnet-5-5')} bulb="idle" size={28} calm />);
        const ginger = await renderScreen(<WorkerSprite kind="ginger" bulb="idle" size={28} calm />);
        expect(pixels(unchanged)).toEqual(pixels(ginger));
        const opus = await renderScreen(<WorkerSprite kind="ragdoll" bulb="idle" size={28} calm />);
        expect(pixels(opus)).toEqual(expectedCat);
        const preview = await renderScreen(<WorkerSprite kind="cxprompt" bulb="idle" size={28} calm preview />);
        expect(pixels(preview)).toEqual(expectedPrompt);
        const live = await renderScreen(<WorkerSprite kind="cxloupe" bulb="idle" size={28} calm />);
        const { deskPrefs } = await import('../deskPrefs');
        await act(async () => deskPrefs.set('noWorkerRobot', 'ipb'));
        expect(pixels(live)).toEqual(expectedLab);
        await act(async () => deskPrefs.set('codexRobot', 'model'));
        expect(pixels(live)).toEqual(expectedLoupe);
    });

    it.each(['model', 'unknown-future-robot'])('hydrates %s as model-tier defaults without rewriting storage', async stored => {
        const { WorkerSprite } = await import('./WorkerSprite');
        const persisted = new MMKV();
        persisted.set('ignorePrevious.codexRobot', stored);
        for (const [model, colour] of [['gpt-6-sol', 'violet'], ['gpt-6-terra', 'green'], ['gpt-6-astra', 'orange']] as const) {
            const screen = await renderScreen(<WorkerSprite kind={spriteForModel(model)} bulb="idle" size={28} calm />);
            expect(screen.findByTestId('ip-sprite-pixels')!.findAllByType('Rect').map(node => node.props.fill)).toContain(robotPresets[colour].body);
        }
        expect(persisted.getString('ignorePrevious.codexRobot')).toBe(stored);
    });

    it.each([24, 28, 32, 40, 48] as const)('uses whole pixel cells in the %s px slot', async (size) => {
        const { WorkerSprite } = await import('./WorkerSprite');
        const screen = await renderScreen(<WorkerSprite kind="ragdoll" bulb="turn" size={size} testID="face" />);
        expect(screen.findByTestId('face')!.props.style).toMatchObject({ width: size, height: size });
        const pixels = screen.findByTestId('ip-sprite-pixels')!;
        expect(pixels.props.width).toBe(size);
        const rects = pixels.findAll(node => typeof node.type === 'string' && node.props.width != null && node.props.x != null);
        expect(rects.length).toBeGreaterThan(0);
        for (const rect of rects) for (const key of ['x', 'y', 'width', 'height']) expect(Number.isInteger(rect.props[key])).toBe(true);
    });

    it('keeps the same contrast-safe 28 px state cue on every face (M16)', async () => {
        const { WorkerSprite } = await import('./WorkerSprite');
        for (const kind of Object.keys(spriteGrids) as SpriteKind[]) {
            for (const bulb of ['turn', 'stuck', 'working', 'waiting', 'idle'] as Bulb[]) {
                const screen = await renderScreen(<WorkerSprite kind={kind} bulb={bulb} size={28} calm />);
                expect(screen.findByTestId('ip-sprite-signal')!.props).toMatchObject({
                    fill: spriteSignalColour(deskThemes.night, bulb), width: 5, height: 5,
                });
                expect(screen.findByTestId('ip-sprite-stuck-x') !== null).toBe(bulb === 'stuck');
            }
        }
    });

    it.each([
        ['ipdroid', 'droid'], ['ipb', 'b'], ['cxprompt', 'prompt'],
        ['cxloupe', 'loupe'], ['cxlab', 'lab'],
    ] as const)('uses %s default paint and state-lit eyes', async (kind, robot) => {
        const { WorkerSprite } = await import('./WorkerSprite');
        const screen = await renderScreen(<WorkerSprite kind={kind} bulb="working" size={28} calm />);
        const pixels = screen.findByTestId('ip-sprite-pixels')!;
        const fills = pixels.findAll(node => typeof node.type === 'string' && typeof node.props.fill === 'string').map(node => node.props.fill);
        expect(fills).toContain(robotPresets[robotColourDefaults[robot]].body);
        expect(fills).toContain(deskThemes.night.work);
    });

    it('switches to approved style B, with working headphones and a steady cursor', async () => {
        const { WorkerSprite } = await import('./WorkerSprite');
        const screen = await renderScreen(<WorkerSprite kind="ipb" bulb="working" size={40} faceStyle="B" calm />);
        expect(screen.findByTestId('ip-sprite-pixels')).toBeNull();
        const face = screen.findByTestId('ip-sprite-ascii')!.findAllByType('SvgText')[2];
        // The general text helper inserts spaces between nodes; SVG spans share one text line.
        expect(face.children.map(child => typeof child === 'string' ? child : child.props.children).join('').replace(/\u00a0/g, ' ')).toBe('d|- -|b');
        expect(screen.findByTestId('ip-sprite-cursor')!.props.fill).toBe(deskThemes.night.work);
        expect(motion.active.size).toBe(0);
    });

    it.each(Object.keys(asciiSprites) as SpriteKind[])('colours only %s style B eyes by state, including stuck X glyphs', async (kind) => {
        const { WorkerSprite } = await import('./WorkerSprite');
        for (const bulb of ['idle', 'turn', 'stuck'] as const) {
            const screen = await renderScreen(<WorkerSprite kind={kind} bulb={bulb} size={28} faceStyle="B" calm />);
            const ascii = screen.findByTestId('ip-sprite-ascii')!;
            const eyes = ascii.findAllByType('TSpan');
            expect(eyes).toHaveLength(asciiSprites[kind].full.join('').match(/E/g)!.length);
            expect(eyes.map(eye => eye.props.fill)).toEqual(eyes.map(() => deskThemes.night[spriteStateTokens[bulb]]));
            const glyph = bulb === 'stuck' ? 'x' : kind === 'cxprompt' ? (bulb === 'turn' ? '_' : '\u00a0') : bulb === 'turn' ? 'o' : '-';
            expect(eyes.map(eye => eye.props.children)).toEqual(eyes.map(() => glyph));
            expect(ascii.findAllByType('SvgText').every(line => line.props.fill === spriteAsciiColour(deskThemes.night, kind))).toBe(true);
        }
    });

    it('reacts to robot paint, no-worker and face preferences', async () => {
        const { WorkerSprite } = await import('./WorkerSprite');
        const { deskPrefs } = await import('../deskPrefs');
        const screen = await renderScreen(<WorkerSprite kind="no-worker" bulb="idle" size={40} calm />);
        const fills = () => screen.findByTestId('ip-sprite-pixels')!.findAll(node => typeof node.type === 'string' && typeof node.props.fill === 'string').map(node => node.props.fill);
        expect(fills()).toContain(robotPresets.purple.body);
        await act(async () => deskPrefs.set('noWorkerRobot', 'ipb'));
        expect(fills()).toContain(robotPresets.blue.body);
        await act(async () => deskPrefs.set('robotIpb', 'steel'));
        expect(fills()).toContain(robotPresets.steel.body);
        await act(async () => deskPrefs.set('workerFaces', 'B'));
        expect(screen.findByTestId('ip-sprite-ascii')).not.toBeNull();
        expect(screen.findByTestId('ip-sprite-pixels')).toBeNull();
    });

    it.each(Object.keys(spriteGrids) as SpriteKind[])('switches %s to ASCII from the shared preference', async (kind) => {
        const { WorkerSprite } = await import('./WorkerSprite');
        const { deskPrefs } = await import('../deskPrefs');
        const screen = await renderScreen(<WorkerSprite kind={kind} bulb="idle" size={28} calm />);
        expect(screen.findByTestId('ip-sprite-pixels')).not.toBeNull();
        await act(async () => deskPrefs.set('workerFaces', 'B'));
        expect(screen.findByTestId('ip-sprite-ascii')).not.toBeNull();
    });

    it('bobs IPB four times over 1.6 s, then stays still until the next start', async () => {
        const { WorkerSprite } = await import('./WorkerSprite');
        const screen = await renderScreen(<WorkerSprite kind="ipb" bulb="idle" size={28} testID="face" />);
        await act(async () => { screen.tree.update(<WorkerSprite kind="ipb" bulb="working" size={28} testID="face" />); });
        const bob = screen.findByTestId('ip-sprite-art')!.props.style.transform[0].translateY;
        expect(bob.config.outputRange).toEqual([0, 2, 0, 2, 0, 2, 0, 2, 0]);
        expect(motion.durations).toEqual([1600]);
        await act(async () => { vi.advanceTimersByTime(1599); });
        expect(motion.active.size).toBe(1);
        await act(async () => { vi.advanceTimersByTime(1); });
        expect(motion.active.size).toBe(0);
        await act(async () => { screen.tree.update(<WorkerSprite kind="ipb" bulb="working" size={28} testID="face" />); vi.advanceTimersByTime(10_000); });
        expect(motion.durations).toEqual([1600]);
        await act(async () => { screen.tree.update(<WorkerSprite kind="ipb" bulb="idle" size={28} />); });
        await act(async () => { screen.tree.update(<WorkerSprite kind="ipb" bulb="working" size={28} />); });
        expect(motion.durations).toEqual([1600, 1600]);
    });

    it.each(['calm', 'reduced'] as const)('disables bob with %s motion', async (mode) => {
        const { WorkerSprite } = await import('./WorkerSprite');
        motion.reduced = mode === 'reduced';
        await renderScreen(<WorkerSprite kind="ipb" bulb="working" size={28} calm={mode === 'calm'} />);
        expect(motion.durations).toEqual([]);
        expect(motion.active.size).toBe(0);
    });

    it('stops bob on a state change, reduced motion and unmount', async () => {
        const { WorkerSprite } = await import('./WorkerSprite');
        const screen = await renderScreen(<WorkerSprite kind="ipb" bulb="working" size={28} />);
        motion.reduced = true;
        await act(async () => { screen.tree.update(<WorkerSprite kind="ipb" bulb="working" size={28} testID="reduced" />); });
        expect(motion.active.size).toBe(0);
        motion.reduced = false;
        await act(async () => { screen.tree.update(<WorkerSprite kind="ipb" bulb="idle" size={28} />); });
        await act(async () => { screen.tree.update(<WorkerSprite kind="ipb" bulb="working" size={28} />); });
        expect(motion.active.size).toBe(1);
        await act(async () => { screen.tree.unmount(); });
        expect(motion.active.size).toBe(0);
    });
});
