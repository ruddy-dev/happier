import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { ComponentType } from 'react';
import type { PressableProps } from 'react-native';
import * as React from 'react';
import { transformSync } from '@babel/core';

/** Runs installed RN focus/press logic; only native host/services are substituted. No device rendering. */
export function installedNativePressable(os: 'ios' | 'android'): ComponentType<PressableProps> {
    const require = createRequire(import.meta.url);
    const rnRoot = dirname(require.resolve('react-native/package.json'));
    const cache = new Map<string, { exports: unknown }>();
    const boundaries: Record<string, unknown> = {
        'Libraries/Components/View/View.js': 'NativeView',
        'Libraries/Components/View/ViewNativeComponent.js': { Commands: {} },
        'Libraries/Components/Sound/SoundManager.js': { playTouchSound() {} },
        'Libraries/ReactNative/UIManager.js': {},
        // Native feature flags are an environment boundary. Pointer hover is irrelevant to focus.
        'Libraries/ReactNative/ReactNativeFeatureFlags.js': { shouldPressibilityUseW3CPointerEventsForHover: () => false },
        'Libraries/Utilities/Platform.js': { OS: os },
        'Libraries/StyleSheet/processColor.js': (color: unknown) => color,
        'Libraries/Pressability/PressabilityDebug.js': { PressabilityDebugView: () => null },
    };
    function load(path: string): unknown {
        const relative = path.slice(rnRoot.length + 1);
        if (relative in boundaries) return boundaries[relative];
        const existing = cache.get(path);
        if (existing) return existing.exports;
        const module = { exports: {} as unknown };
        cache.set(path, module);
        const code = transformSync(readFileSync(path, 'utf8'), {
            filename: path, babelrc: false, configFile: false,
            presets: [[require.resolve('@react-native/babel-preset'), { useTransformReactJSXExperimental: false }]],
        })!.code!;
        const localRequire = (id: string): unknown => {
            if (id === 'react') return React;
            if (!id.startsWith('.')) return require(id);
            const target = resolve(dirname(path), id);
            return load(target.endsWith('.js') ? target : `${target}.js`);
        };
        new Function('require', 'module', 'exports', '__DEV__', code)(localRequire, module, module.exports, false);
        return module.exports;
    }
    // This untyped boundary is the installed Flow module, compiled above without changing its logic.
    return (load(resolve(rnRoot, 'Libraries/Components/Pressable/Pressable.js')) as { default: ComponentType<PressableProps> }).default;
}
