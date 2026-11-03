import { act } from 'react-test-renderer';
import { afterEach, expect, it } from 'vitest';
import { renderHook, standardCleanup } from '@/dev/testkit';
import { readReactNativeMmkvStubEntries } from '@/dev/testkit/mocks/mmkv';
import { useShogModelPreferences, shogModelKey, enabledShogModels } from './shogModels';

afterEach(standardCleanup);

it('starts with the approved three choices and Opus without materializing prefs', async () => {
    const hook = await renderHook(useShogModelPreferences);
    expect(hook.getCurrent().enabled).toEqual(['claude:claude-opus-5-5', 'codex:gpt-6.1-sol', 'codex:gpt-6-astra']);
    expect(hook.getCurrent().lastUsed).toEqual({ provider: 'claude', modelId: 'claude-opus-5-5' });
    expect(readReactNativeMmkvStubEntries()).toEqual([]);
});

it('keeps ticked models and last-used across a remount through the desk store', async () => {
    const hook = await renderHook(useShogModelPreferences);
    await act(async () => {
        hook.getCurrent().toggle('codex:gpt-6.1-sol');
        hook.getCurrent().remember({ provider: 'codex', modelId: 'gpt-6-astra' });
    });
    await hook.unmount();
    const remountedPreferences = await renderHook(useShogModelPreferences);
    expect(remountedPreferences.getCurrent().enabled).toEqual(['claude:claude-opus-5-5', 'codex:gpt-6-astra']);
    expect(remountedPreferences.getCurrent().lastUsed).toEqual({ provider: 'codex', modelId: 'gpt-6-astra' });
    const reported = [
        { provider: 'claude' as const, modelId: 'claude-opus-5-5', label: 'Opus' },
        { provider: 'codex' as const, modelId: 'gpt-6-astra', label: 'Astra' },
        { provider: 'codex' as const, modelId: 'another-cli-model', label: 'Another' },
    ];
    expect(enabledShogModels(reported, remountedPreferences.getCurrent().enabled).map(shogModelKey))
        .toEqual(['claude:claude-opus-5-5', 'codex:gpt-6-astra']);
});
