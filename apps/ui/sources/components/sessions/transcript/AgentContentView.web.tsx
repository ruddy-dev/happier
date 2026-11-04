import { useHeaderHeight } from '@/utils/platform/responsive';
import { ComposerKeyboardScaffold } from '@/components/sessions/keyboardAvoidance';
import { useSessionCockpitBottomChromeHeight } from '@/components/workspaceCockpit/session/SessionCockpitChromeRegistry';
import * as React from 'react';
import { View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { useKeyboardDismissOnTap } from './useKeyboardDismissOnTap';
import { TranscriptAppearanceContext } from './TranscriptAppearanceContext';
import { useCoordinatorTranscriptLayout } from '@/ignorePrevious/model/coordinatorComposerInput';

interface AgentContentViewProps {
    input?: React.ReactNode | null;
    content?: React.ReactNode | null;
    placeholder?: React.ReactNode | null;
    safeAreaBottom?: number;
}

export const AgentContentView: React.FC<AgentContentViewProps> = React.memo(({
    input,
    content,
    placeholder,
    safeAreaBottom,
}) => {
    const safeArea = useSafeAreaInsets();
    const headerHeight = useHeaderHeight();
    const bottomChromeHeight = useSessionCockpitBottomChromeHeight();
    const keyboardDismissOnTapHandlers = useKeyboardDismissOnTap();
    const onTranscriptLayout = useCoordinatorTranscriptLayout();
    const { theme } = useUnistyles();
    const appearance = React.useContext(TranscriptAppearanceContext);
    const backgroundColor = appearance?.shellColors?.background ?? theme.colors.surface.base;
    // Reserve the floating bar's height inside the session screen (see the native
    // controller for the rationale): the bar overlays content, so the composer is
    // lifted above it here rather than by an in-flow chrome-host reservation.
    return (
        <View style={{ flex: 1, minHeight: 0, paddingBottom: bottomChromeHeight, backgroundColor }}>
            <ComposerKeyboardScaffold
                testID="agent-content-keyboard-host"
                mode="session"
                surfaceColor={appearance?.shellColors?.background}
                contentTestID="agent-content-scroll-region"
                composerTestID="agent-content-input-footer"
                layoutBottomInset={bottomChromeHeight}
                safeAreaBottom={safeAreaBottom ?? safeArea.bottom}
                headerHeight={headerHeight}
                contentProps={{ ...keyboardDismissOnTapHandlers, onLayout: onTranscriptLayout }}
                composer={input}
            >
                {content ? (
                    <View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }]}>
                        {content}
                    </View>
                ) : null}
                {placeholder ? (
                    <ScrollView
                        style={[{ position: 'absolute', top: safeArea.top + headerHeight, left: 0, right: 0, bottom: 0 }]}
                        contentContainerStyle={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}
                        keyboardShouldPersistTaps="handled"
                        alwaysBounceVertical={false}
                    >
                        {placeholder}
                    </ScrollView>
                ) : null}
            </ComposerKeyboardScaffold>
        </View>
    );
});
