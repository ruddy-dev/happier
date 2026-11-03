import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { deskPrefs } from '../deskPrefs';
import { QuestionTranscriptFixture } from './QuestionTranscriptFixture';

afterEach(() => { standardCleanup(); deskPrefs.set('chatStyle', 'mask'); });

describe('offline question transcript activity', () => {
    it.each(['terminal', 'mask'] as const)('renders and expands the real group in %s', async (style) => {
        deskPrefs.set('chatStyle', style);
        const screen = await renderScreen(<AppPaneProvider><QuestionTranscriptFixture /></AppPaneProvider>);
        expect(screen.findByTestId('ip-fixture-tool-group')).not.toBeNull();
        const header = () => screen.findByTestId('transcript-tool-calls-header')!;
        expect(header().props.accessibilityState.expanded).toBe(false);
        expect(screen.findAllByTestId('transcript-tool-calls-unit-tool')).toHaveLength(0);
        expect(screen.findByTestId('ip-question-card')).not.toBeNull();
        await act(async () => header().props.onPress());
        expect(header().props.accessibilityState.expanded).toBe(true);
        expect(screen.findAllByTestId('transcript-tool-calls-unit-tool')).toHaveLength(2);
        await act(async () => header().props.onPress());
        expect(screen.findAllByTestId('transcript-tool-calls-unit-tool')).toHaveLength(0);
    });
});
