import * as React from 'react';
import { Platform } from 'react-native';

/** React Native Web's Pressable handles Enter on tabs, but Space only on buttons. */
export function useWebTabSpace(onPress: () => void, enabled = true) {
    const armed = React.useRef(false);
    const cancel = () => { armed.current = false; };
    const webProps = Platform.OS === 'web' && enabled ? {
        onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key !== ' ' || event.altKey || event.ctrlKey || event.metaKey) return;
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) armed.current = true;
        },
        onKeyUp: (event: React.KeyboardEvent) => {
            if (event.key !== ' ' || !armed.current) return;
            armed.current = false;
            event.preventDefault();
            event.stopPropagation();
            onPress();
        },
    } : {};
    return { webProps, cancel };
}
