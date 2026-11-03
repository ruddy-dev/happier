import * as React from 'react';
import { StyleSheet } from 'react-native';
import { describe, expect, it } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { MessageView } from '@/components/sessions/transcript/MessageView';
import { TranscriptJumpAttention } from '@/components/sessions/transcript/navigation/TranscriptJumpHighlightOverlay';
import { TranscriptAppearanceContext } from '@/components/sessions/transcript/TranscriptAppearanceContext';
import type { Message } from '@/sync/domains/messages/messageTypes';

const message: Message = { kind: 'user-text', id: 'prompt', localId: null, createdAt: 1, text: 'Review the issue' };

describe('Terminal prompt alignment', () => {
    it('aligns the prompt at the leading edge without changing ordinary chat', async () => {
        const row = <MessageView message={message} sessionId="fixture" metadata={null} />;
        const screen = await renderScreen(row);
        const alignment = () => StyleSheet.flatten(screen.tree.findByType(TranscriptJumpAttention).parent!.props.style).alignSelf;
        expect(alignment()).toBe('flex-end');
        await screen.update(<TranscriptAppearanceContext.Provider value={{ userLeading: React.createElement('prompt-marker') }}>{row}</TranscriptAppearanceContext.Provider>);
        expect(alignment()).toBe('flex-start');
        await screen.update(row);
        expect(alignment()).toBe('flex-end');
    });
});
