import * as React from 'react';
import { expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';

const screen = vi.hoisted(() => vi.fn((_props: { options?: unknown }) => null));
vi.mock('expo-router', () => ({ Stack: { Screen: screen } }));
vi.mock('@/ignorePrevious/screens/DeskScreen', () => ({ DeskScreen: () => null }));

it('opts the desk route out of the stack header', async () => {
    const { default: DeskPage } = await import('@/app/(app)/desk/index');
    await renderScreen(<DeskPage />);
    expect(screen.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ options: expect.objectContaining({ headerShown: false }) }));
});
