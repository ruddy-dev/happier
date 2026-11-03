import * as React from 'react';
import { StyleSheet } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { MessageView } from '@/components/sessions/transcript/MessageView';
import { TranscriptJumpAttention } from '@/components/sessions/transcript/navigation/TranscriptJumpHighlightOverlay';
import { TranscriptAppearanceContext, type TranscriptAppearance } from '@/components/sessions/transcript/TranscriptAppearanceContext';
import { useEnrichedMarkdownStyle } from '@/components/markdown/enriched/useEnrichedMarkdownStyle';
import { MarkdownBlockView } from '@/components/markdown/MarkdownBlockView';
import type { Message } from '@/sync/domains/messages/messageTypes';
import { Typography } from '@/constants/Typography';
import { storage } from '@/sync/domains/state/storage';
import { deskPrefs } from './deskPrefs';
import { useCoordinatorTranscriptAppearance } from './useCoordinatorTranscriptAppearance';

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

afterEach(standardCleanup);
const messages: Message[] = [
    { kind: 'user-text', id: 'u1', localId: null, createdAt: 1, text: 'User words' },
    { kind: 'agent-text', id: 'a1', localId: null, createdAt: 2, text: 'Agent words' },
    { kind: 'tool-call', id: 't1', localId: null, createdAt: 3, children: [], tool: {
        id: 'tool1', name: 'read', state: 'completed', input: {}, result: {},
        createdAt: 3, startedAt: 3, completedAt: 4, description: null,
    } },
];
const appearance: TranscriptAppearance = {
    userBubbleStyle: { borderRadius: 0, backgroundColor: 'navy' },
    agentContainerStyle: { borderRadius: 0, backgroundColor: 'navy', borderLeftWidth: 2, borderLeftColor: 'cyan' },
    toolContainerStyle: { borderRadius: 0, backgroundColor: 'navy' },
    fontFamily: 'Test Mono',
    markdownColors: {
        text: { primary: '#eeeeee', secondary: '#bbbbbb', link: '#00ffff' },
        surface: { inset: '#101010', elevated: '#202020', selected: '#202020' },
        border: { default: '#444444' },
    },
};
function CoordinatorRows() {
    const appearance = useCoordinatorTranscriptAppearance();
    return <TranscriptAppearanceContext.Provider value={appearance}><Rows /></TranscriptAppearanceContext.Provider>;
}
function Rows() {
    return <>{messages.map(message => <MessageView key={message.id} message={message} sessionId="chat" metadata={null} />)}</>;
}
function toolChrome(screen: Awaited<ReturnType<typeof renderScreen>>) {
    return screen.tree.findAll(node => node.props?.tool?.id === 'tool1')[0];
}
function MarkdownProbe() {
    const enriched = useEnrichedMarkdownStyle({ profile: 'transcript' });
    return <>
        {React.createElement('probe', { bundle: enriched })}
        <MarkdownBlockView block={{ type: 'text', content: [{ text: 'Body words', styles: [], url: null }, { text: 'Bold words', styles: ['bold'], url: null }] }}
            first last selectable profile="transcript" variant="default" streamingReveal={false} agentTexMath={false} />
    </>;
}

describe('C15/C16 transcript appearance', () => {
    it('without a provider keeps stock user, agent and tool styles and markdown fonts', async () => {
        const screen = await renderScreen(<><Rows /><MarkdownProbe /></>);
        const jumps = screen.tree.findAllByType(TranscriptJumpAttention);
        expect(jumps.map(node => StyleSheet.flatten(node.props.style))).toMatchSnapshot();
        expect(StyleSheet.flatten(toolChrome(screen).parent!.props.style)).toMatchSnapshot('stock tool container');
        expect(screen.tree.findByType('probe').props.bundle.markdownStyle.paragraph.fontFamily).toBe(Typography.default().fontFamily);
        const body = screen.tree.findAll(node => typeof node.type === 'string' && node.children.includes('Body words'))[0];
        expect(StyleSheet.flatten(body.props.style)?.fontFamily).toBe(Typography.default().fontFamily);
        const stock = JSON.stringify(screen.tree.toJSON());
        await screen.update(<TranscriptAppearanceContext.Provider value={null}><Rows /><MarkdownProbe /></TranscriptAppearanceContext.Provider>);
        expect(JSON.stringify(screen.tree.toJSON())).toEqual(stock);
    });

    it('uses the appearance font and colour for active streaming text', async () => {
        const settings = storage.getState().settings;
        storage.setState({ settings: { ...settings, transcriptStreamingMarkdownRenderingEnabled: false } });
        const message: Message = { kind: 'agent-text', id: 'stream', localId: 'segment', createdAt: 2, text: 'Streaming words', meta: {
            happierStreamSegmentV1: { v: 1, segmentKind: 'assistant', segmentLocalId: 'segment', segmentState: 'streaming', startedAtMs: 1000, updatedAtMs: 1000 },
        } };
        const screen = await renderScreen(<TranscriptAppearanceContext.Provider value={appearance}><MessageView message={message} sessionId="chat" metadata={null} /></TranscriptAppearanceContext.Provider>);
        const text = screen.findByTestId('transcript-streaming-plain:stream');
        expect(text).not.toBeNull();
        expect(StyleSheet.flatten(text!.props.style)).toMatchObject({ fontFamily: 'Test Mono', color: '#eeeeee' });
        storage.setState({ settings });
    });

    it('keeps tool result markdown in the stock font under a Terminal appearance', async () => {
        const settings = storage.getState().settings;
        storage.setState({ settings: { ...settings, toolViewDetailLevelDefault: 'full' } });
        const message = messages[2];
        if (message.kind !== 'tool-call') throw new Error('expected tool');
        const toolMessage: Message = { ...message, tool: { ...message.tool!, name: 'Reasoning', result: { content: 'Tool result markdown' } } };
        const screen = await renderScreen(<TranscriptAppearanceContext.Provider value={appearance}><MessageView message={toolMessage} sessionId="chat" metadata={null} /></TranscriptAppearanceContext.Provider>);
        const markdown = screen.tree.findAllByType('EnrichedMarkdownText').find(node => node.props.markdown === 'Tool result markdown');
        expect(markdown).toBeDefined();
        expect(markdown!.props.markdownStyle.paragraph.fontFamily).toBe(Typography.default().fontFamily);
        storage.setState({ settings });
    });

    it('applies opt-in square user/agent/tool containers and message text fonts', async () => {
        const screen = await renderScreen(<Rows />);
        const toolTextFonts = () => toolChrome(screen).findAll(node => typeof node.type === 'string' && node.children.some(child => typeof child === 'string')).map(node => StyleSheet.flatten(node.props.style)?.fontFamily);
        const stockToolFonts = toolTextFonts();
        expect(stockToolFonts.length).toBeGreaterThan(0);
        await screen.update(<TranscriptAppearanceContext.Provider value={appearance}><Rows /><MarkdownProbe /></TranscriptAppearanceContext.Provider>);
        expect(toolTextFonts()).toEqual(stockToolFonts);
        const jumps = screen.tree.findAllByType(TranscriptJumpAttention);
        expect(StyleSheet.flatten(jumps[0].props.style)).toMatchObject(StyleSheet.flatten(appearance.userBubbleStyle)!);
        expect(StyleSheet.flatten(jumps[1].props.style)).toMatchObject(StyleSheet.flatten(appearance.agentContainerStyle)!);
        expect(StyleSheet.flatten(toolChrome(screen).parent!.props.style)).toMatchObject(StyleSheet.flatten(appearance.toolContainerStyle)!);
        for (const words of ['User words', 'Agent words']) {
            const text = screen.tree.findAllByType('EnrichedMarkdownText').find(node => node.props.markdown === words)!;
            expect(text.props.markdownStyle.paragraph).toMatchObject({ fontFamily: 'Test Mono', color: '#eeeeee' });
        }
    });

    it('uses the opt-in font in both markdown renderers, including emphasis', async () => {
        const screen = await renderScreen(<TranscriptAppearanceContext.Provider value={appearance}><MarkdownProbe /></TranscriptAppearanceContext.Provider>);
        const markdown = screen.tree.findByType('probe').props.bundle.markdownStyle;
        for (const key of ['paragraph', 'strong', 'em', 'link', 'list', 'h1', 'code', 'table']) expect(markdown[key].fontFamily).toBe('Test Mono');
        expect(markdown.strong.fontWeight).toBe('bold');
        expect(markdown.paragraph.color).toBe('#eeeeee');
        expect(markdown.link.color).toBe('#00ffff');
        for (const words of ['Body words', 'Bold words']) {
            const text = screen.tree.findAll(node => typeof node.type === 'string' && node.children.includes(words))[0];
            expect(StyleSheet.flatten(text.props.style)).toMatchObject({ fontFamily: 'Test Mono', color: '#eeeeee' });
        }
    });

    it('uses the prompt only for the Terminal coordinator style', async () => {
        deskPrefs.set('chatStyle', 'terminal');
        const screen = await renderScreen(<CoordinatorRows />);
        expect(screen.tree.findAll(node => typeof node.type === 'string' && node.children.includes('> '))).toHaveLength(1);
        deskPrefs.set('chatStyle', 'mask');
        await screen.update(<CoordinatorRows />);
        expect(screen.tree.findAll(node => typeof node.type === 'string' && node.children.includes('> '))).toHaveLength(0);
    });

    it('shows a terminal prompt on user messages only, without changing normal transcripts', async () => {
        const screen = await renderScreen(<Rows />);
        expect(screen.tree.findAllByType('terminal-prompt')).toHaveLength(0);
        await screen.update(<TranscriptAppearanceContext.Provider value={{ userLeading: React.createElement('terminal-prompt') }}><Rows /></TranscriptAppearanceContext.Provider>);
        expect(screen.tree.findAllByType(TranscriptJumpAttention).map(row => row.findAllByType('terminal-prompt').length)).toEqual([1, 0, 0]);
        await screen.update(<Rows />);
        expect(screen.tree.findAllByType('terminal-prompt')).toHaveLength(0);
    });

    it('shows a leading slot on agent messages only and removes it when the appearance changes', async () => {
        const screen = await renderScreen(<TranscriptAppearanceContext.Provider value={{ agentLeading: React.createElement('mask-avatar') }}><Rows /></TranscriptAppearanceContext.Provider>);
        expect(screen.tree.findAllByType('mask-avatar')).toHaveLength(1);
        expect(screen.tree.findAllByType(TranscriptJumpAttention).map(row => row.findAllByType('mask-avatar').length)).toEqual([0, 1, 0]);
        await screen.update(<TranscriptAppearanceContext.Provider value={appearance}><Rows /></TranscriptAppearanceContext.Provider>);
        expect(screen.tree.findAllByType('mask-avatar')).toHaveLength(0);
    });
});
