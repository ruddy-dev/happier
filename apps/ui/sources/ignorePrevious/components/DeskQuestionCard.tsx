import * as React from 'react';
import { Platform, View } from 'react-native';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';
import { DESK_FONT_STACK } from '../fonts/deskFont';
import { useDeskPref } from '../deskPrefs';
import { terminalPalettes, useDeskPaint } from '../palette';
import { DeskContextDataContext, resolveQuestionContext } from '../model/questionContext';

/** Presentation only: the question renderer retains ownership of answers and submission. */
export function DeskQuestionCard({ children, active, actionable, contextText }: { children: React.ReactNode; active: boolean; actionable: boolean; contextText: readonly string[] }) {
    const providedData = React.useContext(DeskContextDataContext);
    const context = resolveQuestionContext(contextText, providedData);
    const [style] = useDeskPref('chatStyle');
    const [palette] = useDeskPref('terminalPalette');
    const { paint: slip } = useDeskPaint();
    const paint = style === 'terminal' ? terminalPalettes[palette] : slip;
    const terminal = style === 'terminal';
    return <View testID="ip-question-card" style={{
        backgroundColor: paint.panel, borderColor: terminal ? paint.rule : paint.edge, borderWidth: 1,
        ...(terminal ? { borderLeftColor: paint.yel, borderLeftWidth: 3 } : {}), borderRadius: terminal ? 0 : 10,
        overflow: 'hidden',
    }}>
        {active ? <View style={{
            backgroundColor: terminal ? 'transparent' : paint.yel, paddingHorizontal: 12, paddingVertical: 6,
            ...(terminal ? { borderBottomWidth: 1, borderBottomColor: paint.rule, borderStyle: Platform.OS === 'web' ? 'dashed' : 'solid' } : {}),
        }}>
            <Text style={{ color: terminal ? paint.warn : paint.yelink, fontFamily: DESK_FONT_STACK, fontWeight: '700' }}>{actionable ? t('ignorePrevious.transcriptQuestionChrome.title') : t('tools.names.question')}</Text>
        </View> : null}
        <View style={{ padding: 12 }}>
            {context ? <Text testID="ip-question-context" style={{ color: paint.mute, fontFamily: DESK_FONT_STACK }}>{t('ignorePrevious.transcriptQuestionChrome.context')}: {context.project} · {context.issue}</Text> : null}
            {children}
        </View>
    </View>;
}
