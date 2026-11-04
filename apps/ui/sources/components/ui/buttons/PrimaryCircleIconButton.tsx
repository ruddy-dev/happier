import * as React from 'react';
import { Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';

import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { normalizeNodeForView } from '@/components/ui/rendering/normalizeNodeForView';
import { GradientSurface } from '@/components/ui/surfaces/GradientSurface';

const stylesheet = StyleSheet.create((theme) => ({
  root: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  inner: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
}));

export const PrimaryCircleIconButton = React.memo(
  (
    props: Readonly<{
      active: boolean;
      /** Solid active paint replaces the theme gradient; callers pair their glyph with tint. */
      activeColors?: Readonly<{ background: string; tint: string }>;
      disabled?: boolean;
      loading?: boolean;
      testID?: string;
      accessibilityLabel: string;
      accessibilityHint?: string;
      accessibilityState?: { disabled?: boolean } & Record<string, unknown>;
      hitSlop?: any;
      onPress?: () => void;
      style?: StyleProp<ViewStyle>;
      children?: React.ReactNode;
    }>,
  ) => {
    const { theme } = useUnistyles();
    const styles = stylesheet;

    const computedDisabled = Boolean(props.disabled || props.loading || !props.onPress);
    const primary = theme.colors.button?.primary;
    const backgroundColor = props.active
      ? (props.activeColors?.background ?? primary?.background ?? theme.colors.surface.inset ?? theme.colors.surface.base)
      : (primary?.disabled ?? theme.colors.border.default);
    const tintColor = (props.active ? props.activeColors?.tint : undefined) ?? primary?.tint ?? theme.colors.text.primary;

    return (
      <View style={[styles.root, props.style]}>
        <Pressable
          testID={props.testID}
          accessibilityRole="button"
          accessibilityLabel={props.accessibilityLabel}
          accessibilityHint={props.accessibilityHint}
          accessibilityState={{ ...(props.accessibilityState ?? {}), disabled: computedDisabled }}
          hitSlop={props.hitSlop}
          disabled={computedDisabled}
          onPress={props.onPress}
          style={({ pressed }) => [
            styles.inner,
            {
              borderRadius: 16,
              backgroundColor,
              opacity: pressed ? 0.72 : 1,
              overflow: 'hidden',
            },
          ]}
        >
          {props.active && !props.activeColors && primary?.gradient ? (
            <GradientSurface
              fallbackColor={backgroundColor}
              gradient={primary.gradient}
              borderRadius={16}
              style={StyleSheet.absoluteFillObject}
            />
          ) : null}
          {props.loading ? (
            <ActivitySpinner size="small" color={tintColor} />
          ) : (
            normalizeNodeForView(props.children)
          )}
        </Pressable>
      </View>
    );
  },
);
