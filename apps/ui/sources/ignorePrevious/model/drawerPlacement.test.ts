import { expect, it } from 'vitest';
import { drawerPlacement } from './drawerPlacement';

it.each([
    [390, 'fullscreen'], [820, 'fullscreen'], [821, 'overlay'], [1100, 'overlay'],
    [1180, 'overlay'], [1181, 'docked'], [1440, 'docked'],
] as const)('D-series / Q13: width %s places Waiting as %s', (width, expected) => {
    expect(drawerPlacement(width)).toBe(expected);
});
