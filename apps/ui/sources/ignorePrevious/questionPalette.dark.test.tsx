import { vi } from 'vitest';
import { darkTheme } from '@/theme';
import { questionPaletteChecks } from './testkit/questionPaletteChecks';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    const { darkTheme } = await import('@/theme');
    return createUnistylesMock({ theme: darkTheme });
});
vi.mock('@/components/sessions/terminal/openAttachedSessionTerminal', () => ({
    useOpenAttachedSessionTerminal: () => ({ available: false, unavailableReason: 'missing_session', open: vi.fn() }),
}));

questionPaletteChecks(darkTheme, 'terminalPaper');
