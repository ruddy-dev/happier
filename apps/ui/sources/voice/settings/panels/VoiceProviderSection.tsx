import * as React from 'react';

import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import type { VoiceSettings } from '@/sync/domains/settings/voiceSettings';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';
import { DeskVoicePageContext } from '@/ignorePrevious/appearance/deskPageThemeContext';

export function VoiceProviderSection(props: {
  voice: VoiceSettings;
  setVoice: (next: VoiceSettings) => void;
  happierVoiceSupported: boolean;
}) {
  const { theme } = useUnistyles();
  const deskVoice = React.useContext(DeskVoicePageContext);
  const select = (next: VoiceSettings) => props.setVoice(next);

  const billingMode = props.voice.adapters.realtime_elevenlabs.billingMode;
  const isOff = props.voice.providerId === 'off';
  const isHappier = props.voice.providerId === 'realtime_elevenlabs' && billingMode === 'happier';
  const isByo = props.voice.providerId === 'realtime_elevenlabs' && billingMode === 'byo';
  const isLocal = props.voice.providerId === 'local_direct' || props.voice.providerId === 'local_conversation';

  return (
    <ItemGroup title={t('settingsVoice.modeTitle')}>
      <Item
        testID="ip-voice-mode-off"
        title={t('settingsVoice.mode.off')}
        subtitle={t('settingsVoice.mode.offSubtitle')}
        subtitleLines={deskVoice ? 0 : undefined}
        rightElement={isOff ? <Icon name="check-circle" size={24} color={theme.colors.accent.blue} /> : null}
        onPress={() => select({ ...props.voice, providerId: 'off' })}
        showChevron={false}
      />

      {props.happierVoiceSupported === false ? null : (
        <Item
          title={t('settingsVoice.mode.happier')}
          subtitle={t('settingsVoice.mode.happierSubtitle')}
          subtitleLines={deskVoice ? 0 : undefined}
          rightElement={isHappier ? <Icon name="check-circle" size={24} color={theme.colors.accent.blue} /> : null}
          onPress={() =>
            select({
              ...props.voice,
              providerId: 'realtime_elevenlabs',
              adapters: {
                ...props.voice.adapters,
                realtime_elevenlabs: { ...props.voice.adapters.realtime_elevenlabs, billingMode: 'happier' },
              },
            })
          }
          showChevron={false}
        />
      )}

      <Item
        title={t('settingsVoice.mode.byo')}
        subtitle={t('settingsVoice.mode.byoSubtitle')}
        subtitleLines={deskVoice ? 0 : undefined}
        rightElement={isByo ? <Icon name="check-circle" size={24} color={theme.colors.accent.blue} /> : null}
        onPress={() =>
          select({
            ...props.voice,
            providerId: 'realtime_elevenlabs',
            adapters: {
              ...props.voice.adapters,
              realtime_elevenlabs: { ...props.voice.adapters.realtime_elevenlabs, billingMode: 'byo' },
            },
          })
        }
        showChevron={false}
      />

      <Item
        title={t('settingsVoice.mode.local')}
        subtitle={t('settingsVoice.mode.localSubtitle')}
        subtitleLines={deskVoice ? 0 : undefined}
        rightElement={isLocal ? <Icon name="check-circle" size={24} color={theme.colors.accent.blue} /> : null}
        onPress={() => select({ ...props.voice, providerId: 'local_conversation' })}
        showChevron={false}
      />
    </ItemGroup>
  );
}
