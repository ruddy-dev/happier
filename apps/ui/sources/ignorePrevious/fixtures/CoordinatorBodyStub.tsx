/**
 * Dev-only stand-in for the coordinator's chat in fixture builds. Happier's chat needs an account
 * (without one it shows "Restore with Secret Key"), so the fixture shows a fixed transcript instead.
 * Loaded only by CoordinatorPane when EXPO_PUBLIC_IP_FIXTURES=1; never import it anywhere else.
 */
import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';

import scenario from './desk-fixture.json';
import { CreatureFixture } from './CreatureFixture';

export function CoordinatorBodyStub() {
    const { theme } = useUnistyles();
    const { transcript, composerPlaceholder } = scenario.coordinatorBody;
    return (
        <ScrollView testID="ip-fixture-coordinator-body" style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-between' }}>
            <CreatureFixture />
            <View style={{ gap: 10, padding: 16 }}>
                {transcript.map((line, index) => {
                    const mine = line.from === 'you';
                    return (
                        <View
                            key={index}
                            style={{
                                alignSelf: mine ? 'flex-end' : 'flex-start',
                                maxWidth: '80%',
                                paddingHorizontal: 12,
                                paddingVertical: 8,
                                borderRadius: 12,
                                backgroundColor: mine ? theme.colors.surface.elevated : theme.colors.surface.inset,
                            }}
                        >
                            <Text style={{ color: theme.colors.text.primary, fontSize: 14 }}>{line.text}</Text>
                        </View>
                    );
                })}
            </View>
            <View
                style={{
                    margin: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: theme.colors.border.default,
                }}
            >
                <Text style={{ color: theme.colors.text.secondary, fontSize: 14 }}>{composerPlaceholder}</Text>
            </View>
        </ScrollView>
    );
}
