/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { CockpitTabBar } from './CockpitTabBar';

// Keep the installed RN Web Pressable and its ARIA/event projection real.
vi.mock('react-native', async () => vi.importActual('react-native-web'));
vi.mock('react-native-reanimated', async () => {
    const { View } = await import('react-native-web');
    const { createReanimatedModuleMock } = await import('@/dev/testkit/mocks/reanimated');
    const mock = createReanimatedModuleMock();
    return { ...mock, default: { ...mock.default, View } };
});
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('projects selected and unselected tabs through real RN Web when switching surfaces', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const tabs = [
        { id: 'chat', label: 'Chat', icon: { render: () => null } },
        { id: 'git', label: 'Git', icon: { render: () => null } },
    ] as const;
    function Tabs() {
        const [active, setActive] = React.useState<'chat' | 'git'>('chat');
        return <CockpitTabBar activeSurface={active} tabs={tabs} onSurfacePress={setActive}
            barTestId="cockpit" tabTestIdPrefix="tab-" />;
    }
    try {
        await act(async () => root.render(<Tabs />));
        const chat = container.querySelector<HTMLElement>('[data-testid="tab-chat"]')!;
        const git = container.querySelector<HTMLElement>('[data-testid="tab-git"]')!;
        expect(chat.getAttribute('role')).toBe('tab');
        expect(git.getAttribute('role')).toBe('tab');
        expect(chat.getAttribute('aria-label')).toBe('Chat');
        expect(git.getAttribute('aria-label')).toBe('Git');
        expect(chat.getAttribute('aria-selected')).toBe('true');
        expect(git.getAttribute('aria-selected')).toBe('false');
        await act(async () => git.click());
        expect(chat.getAttribute('aria-selected')).toBe('false');
        expect(git.getAttribute('aria-selected')).toBe('true');
        await act(async () => chat.click());
        expect(chat.getAttribute('aria-selected')).toBe('true');
        expect(git.getAttribute('aria-selected')).toBe('false');
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
