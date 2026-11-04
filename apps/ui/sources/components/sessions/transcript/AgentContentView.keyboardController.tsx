import { useHeaderHeight } from '@/utils/platform/responsive';
import { ComposerKeyboardScaffold } from '@/components/sessions/keyboardAvoidance';
import { useSessionCockpitBottomChromeHeight } from '@/components/workspaceCockpit/session/SessionCockpitChromeRegistry';
import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { useKeyboardDismissOnTap } from './useKeyboardDismissOnTap';
import { TranscriptAppearanceContext } from './TranscriptAppearanceContext';

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
    const { theme } = useUnistyles();
    const appearance = React.useContext(TranscriptAppearanceContext);
    const backgroundColor = appearance?.shellColors?.background ?? theme.colors.surface.base;

    // Reserve the floating bar's height *inside the session screen* (not the global
    // chrome host) so the composer/transcript sit above the overlay bar AND this
    // reserved area slides away with the session on dismiss — the window canvas
    // behind the bar is never exposed as a lingering bottom band. `bottomChromeHeight`
    // is 0 when the bar is hidden (e.g. keyboard open), collapsing the reservation
    // so the scaffold geometry is identical to having no bar.
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
                contentProps={keyboardDismissOnTapHandlers}
                composer={input}
            >
                {content ? (
                    <View style={{ flex: 1, minHeight: 0 }}>
                        {content}
                    </View>
                ) : null}
                {placeholder ? (
                    <ScrollView
                        style={{ position: 'absolute', top: safeArea.top + headerHeight, left: 0, right: 0, bottom: 0 }}
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
