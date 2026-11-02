import * as React from 'react';
import { act } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { RunSettingsMenu } from './RunSettingsMenu';

vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeNativeMock({ platformOS: 'ios' });
});
vi.mock('@/hooks/ui/useReducedMotionPreference', async () => {
    const { createReducedMotionModuleMock } = await import('@/dev/testkit/mocks/reducedMotion');
    return createReducedMotionModuleMock(true);
});
it('M2 dismisses the native menu by pressing outside its content', async () => {
    const screen = await renderScreen(<RunSettingsMenu />);
    await screen.pressByTestIdAsync('ip-run-settings');
    expect(screen.findByTestId('ip-run-menu')).not.toBeNull();
    // The native backdrop is the unlabelled press target outside the menu content.
    const backdrop = screen.tree.findAll(node => typeof node.type === 'string'
        && typeof node.props.onPress === 'function' && node.props.pointerEvents === 'auto'
        && !node.props.testID);
    expect(backdrop).toHaveLength(1);
    await act(async () => backdrop[0].props.onPress());
    expect(screen.findByTestId('ip-run-menu')).toBeNull();
    expect(screen.findByTestId('ip-run-settings')?.props.accessibilityState.expanded).toBe(false);
});
