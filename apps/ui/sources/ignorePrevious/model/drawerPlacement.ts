export type DrawerPlacement = 'docked' | 'overlay' | 'fullscreen';

export function drawerPlacement(width: number): DrawerPlacement {
    if (width <= 820) return 'fullscreen';
    if (width <= 1180) return 'overlay';
    return 'docked';
}
