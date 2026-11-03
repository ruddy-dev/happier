import * as React from 'react';
import { act } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { ContextGauge } from './ContextGauge';

vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeNativeMock({ platformOS: 'ios' });
});
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { createReducedMotionModuleMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return createReducedMotionModuleMock(true);
});
it('C9 native presses toggle the context popover and its backdrop dismisses it', async () => {
    const session = createSessionFixture({ latestUsage: {
        inputTokens: 0, outputTokens: 0, cacheCreation: 0, cacheRead: 0,
        contextSize: 95_500, contextWindowTokens: 1_000_000, timestamp: 1,
    } });
    const screen = await renderScreen(<ContextGauge session={session} />);
    expect(screen.findByTestId('ip-context-popover')).toBeNull();
    await screen.pressByTestIdAsync('ip-context-gauge');
    expect(screen.findByTestId('ip-context-popover')).not.toBeNull();
    await screen.pressByTestIdAsync('ip-context-gauge');
    expect(screen.findByTestId('ip-context-popover')).toBeNull();
    await screen.pressByTestIdAsync('ip-context-gauge');
    const backdrop = screen.tree.findAll(node => typeof node.type === 'string'
        && typeof node.props.onPress === 'function' && node.props.pointerEvents === 'auto' && !node.props.testID);
    expect(backdrop).toHaveLength(1);
    await act(async () => backdrop[0].props.onPress());
    expect(screen.findByTestId('ip-context-popover')).toBeNull();
});

it('explains missing Codex context rather than showing an invented percentage', async () => {
    const session = createSessionFixture({ metadata: { path: '/scratch', host: 'test', flavor: 'codex' }, latestUsage: null });
    const screen = await renderScreen(<ContextGauge session={session} />);
    expect(screen.getTextContent()).toContain('Codex has not reported enough context information yet.');
    expect(screen.findByTestId('ip-context-gauge')).toBeNull();
});
