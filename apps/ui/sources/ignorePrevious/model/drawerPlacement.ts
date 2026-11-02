export type DrawerPlacement = 'docked' | 'overlay' | 'fullscreen';

export function isDeskPhoneWidth(width: number): boolean {
    return width <= 820;
}

export function drawerPlacement(width: number): DrawerPlacement {
    if (isDeskPhoneWidth(width)) return 'fullscreen';
    if (width <= 1180) return 'overlay';
    return 'docked';
}
