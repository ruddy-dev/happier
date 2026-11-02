// Copyright (c) 2026 ruddy-dev, MIT
import { useUnistyles } from 'react-native-unistyles';

import type { Bulb } from './model/bulb';
import type { SpriteKind } from './sprites';

/**
 * The Ignore Previous overlay's own colours: the mask's yellow and ink, and the four antenna-bulb
 * states, plus mockup 12's desk themes and sprite paints. This is the one place raw
 * colour values live (see apps/ui/AGENTS.md, "named, theme-aware palette in one domain module").
 * The mask reads the same colour adapter as the desk. Desk consumers use the seven theme records below;
 * their known contrast exceptions are tracked in palette.test.ts.
 */
export type IpColours = Readonly<{
    yellow: string;
    red: string;
    work: string;
    off: string;
    idleSignal: string;
    turnSignal: string;
    ink: string;
    bone: string;
    visor: string;
    /** The placeholder shoggoth behind the mask (ShogView): its body, outline and unlit eyes. */
    flesh: string;
    fleshEdge: string;
    paleEye: string;
}>;

/** The current light/dark bridge; the future desk selector replaces this decision only. */
export function useDeskPaint() {
    const { theme } = useUnistyles();
    const selected = theme.dark
        ? { paint: deskThemes.night, borderWidth: 1.5, colours: ipPalette.dark }
        : { paint: deskThemes.paper, borderWidth: 2, colours: ipPalette.light };
    return {
        ...selected,
        // Preserve existing Work chrome paint until the desk selector owns these roles too.
        text: theme.colors.text,
        inset: theme.colors.surface.inset,
        strongBorder: theme.colors.border.strong,
    };
}

export function useIpColours(): IpColours {
    return useDeskPaint().colours;
}

export function bulbColour(colours: IpColours, bulb: Bulb): string {
    switch (bulb) {
        case 'turn':
            return colours.turnSignal;
        case 'stuck':
            return colours.red;
        case 'waiting':
        case 'working':
            return colours.work;
        case 'idle':
            return colours.idleSignal;
    }
}

// Mockup 12, round 8. Desk-only tokens; these do not replace Happier themes.
export const robotPresets = {
    "purple": {
        "body": "#aa5af1",
        "shade": "#6a28b0",
        "hi": "#e0c4ff",
        "dark": "#2a1145",
        "glass": "#3a1866",
        "tint": "#ecdcff"
    },
    "violet": {
        "body": "#8b7cf6",
        "shade": "#5646c4",
        "hi": "#d4ceff",
        "dark": "#171233",
        "glass": "#2a1f5c",
        "tint": "#e6dcff"
    },
    "green": {
        "body": "#23955a",
        "shade": "#12613a",
        "hi": "#a8e8bf",
        "dark": "#0b1f14",
        "glass": "#0f3322",
        "tint": "#d6f5e0"
    },
    "orange": {
        "body": "#d45e17",
        "shade": "#8f3a0a",
        "hi": "#ffc9a0",
        "dark": "#2a1205",
        "glass": "#3a1a08",
        "tint": "#ffe2cc"
    },
    "blue": {
        "body": "#3f7cf5",
        "shade": "#1d3a8a",
        "hi": "#a9c6ff",
        "dark": "#0d1a3d",
        "glass": "#12244f",
        "tint": "#d6e4ff"
    },
    "magenta": {
        "body": "#db30db",
        "shade": "#8a1a8a",
        "hi": "#f6c2f6",
        "dark": "#2b0a2b",
        "glass": "#3a0e3a",
        "tint": "#fbe0fb"
    },
    "steel": {
        "body": "#70839f",
        "shade": "#475670",
        "hi": "#c9d3e2",
        "dark": "#161b24",
        "glass": "#232b38",
        "tint": "#e2e8f0"
    }
} as const;
export type RobotPreset = keyof typeof robotPresets;
export type RobotPaintRole = keyof typeof robotPresets.purple;
export const robotColourDefaults = {
    "droid": "purple",
    "b": "blue",
    "prompt": "green",
    "loupe": "violet",
    "lab": "orange"
} as const satisfies Readonly<Record<string, RobotPreset>>;
export type RobotVariant = keyof typeof robotColourDefaults;
export const robotPaintMap = {
    "ipdroid": {
        "Y": "body",
        "y": "shade",
        "h": "hi"
    },
    "ipb": {
        "C": "body",
        "D": "shade",
        "c": "hi"
    },
    "cxprompt": {
        "g": "body",
        "s": "shade",
        "h": "hi",
        "G": "dark",
        "p": "dark"
    },
    "cxloupe": {
        "V": "body",
        "s": "shade",
        "h": "hi",
        "G": "dark",
        "r": "tint"
    },
    "cxlab": {
        "V": "body",
        "s": "shade",
        "h": "hi",
        "G": "dark",
        "g": "glass",
        "r": "tint"
    }
} as const satisfies Readonly<Record<string, Readonly<Record<string, RobotPaintRole>>>>;

/** CSS token names retained for the later desk skin port. Paper modes share colours.
 * `idleSignal` is the contrast-safe idle cue; `off` retains the original decorative paint.
 * `turnSignal` is the standalone turn cue; `yel` retains brand-yellow sprite rings.
 * `warn` is the readable warning text. `work` is a
 * graphical signal, not a text token. Known contrast exceptions are in palette.test.ts. */
export const deskThemes = {
    "night": {
        "bg": "#0b0b0e",
        "panel": "#14161c",
        "panel2": "#1c1f27",
        "rule": "#2b2f3a",
        "edge": "#2b2f3a",
        "ink": "#f3ecd8",
        "mute": "#a9a397",
        "user": "#ffcf1f",
        "bot": "#f3ecd8",
        "hl": "#ffcf1f",
        "warn": "#ffcf1f",
        "bad": "#ff6a55",
        "info": "#c9c2b0",
        "ok": "#8fd18a",
        "sel": "rgba(255, 207, 31, .3)",
        "work": "#c9c2b0",
        "off": "#3a3e49",
        "idleSignal": "#747986",
        "turnSignal": "#ffcf1f",
        "yel": "#ffcf1f",
        "yelink": "#14161c",
        "brandred": "#e0301e",
        "maskrim": "#f3ecd8",
        "robotInk": {
            "purple": "#c3a0fb",
            "violet": "#b3a9fa",
            "green": "#6fdc8c",
            "orange": "#ff9e64",
            "blue": "#8fb4ff",
            "magenta": "#f08af0",
            "steel": "#aab7cc"
        },
        "spriteInk": {
            "ragdoll": "#7aa2f7",
            "ginger": "#ff9e64",
            "tuxedo": "#d9dce6",
            "fox": "#ff8a4c"
        }
    },
    "paper": {
        "bg": "#f3ecd9",
        "panel": "#f3ecd9",
        "panel2": "#ffffff",
        "rule": "#dbd9d3",
        "edge": "#14161c",
        "ink": "#14161c",
        "mute": "#5b5850",
        "user": "#1d6b3f",
        "bot": "#0a5a73",
        "hl": "#6b3a8a",
        "warn": "#7a4f00",
        "bad": "#b01f0c",
        "info": "#0a5a73",
        "ok": "#1d6b3f",
        "sel": "rgba(255, 207, 31, .6)",
        "work": "#6f6a5e",
        "off": "#cfc7b0",
        "idleSignal": "#827b69",
        "turnSignal": "#9c7b00",
        "yel": "#ffcf1f",
        "yelink": "#14161c",
        "brandred": "#e0301e",
        "maskrim": "#14161c",
        "robotInk": {
            "purple": "#6a3fc2",
            "violet": "#5646c4",
            "green": "#1d6b3f",
            "orange": "#a8480f",
            "blue": "#2f55c4",
            "magenta": "#9a1f9a",
            "steel": "#475670"
        },
        "spriteInk": {
            "ragdoll": "#2f55c4",
            "ginger": "#a8480f",
            "tuxedo": "#14161c",
            "fox": "#a83a0c"
        }
    },
    "tokyo": {
        "bg": "#0b0b11",
        "panel": "#15161e",
        "panel2": "#1d1f2b",
        "rule": "#2f3349",
        "edge": "#2f3349",
        "ink": "#c0caf5",
        "mute": "#8f98c4",
        "user": "#9ece6a",
        "bot": "#7aa2f7",
        "hl": "#bb9af7",
        "warn": "#e0af68",
        "bad": "#f7768e",
        "info": "#7dcfff",
        "ok": "#9ece6a",
        "sel": "#33467c",
        "work": "#7dcfff",
        "off": "#3b4261",
        "idleSignal": "#747d9c",
        "turnSignal": "#ffcf1f",
        "yel": "#ffcf1f",
        "yelink": "#14161c",
        "brandred": "#e0301e",
        "maskrim": "#f3ecd8",
        "robotInk": {
            "purple": "#c3a0fb",
            "violet": "#b3a9fa",
            "green": "#6fdc8c",
            "orange": "#ff9e64",
            "blue": "#8fb4ff",
            "magenta": "#f08af0",
            "steel": "#aab7cc"
        },
        "spriteInk": {
            "ragdoll": "#7aa2f7",
            "ginger": "#ff9e64",
            "tuxedo": "#d9dce6",
            "fox": "#ff8a4c"
        }
    },
    "kanagawa": {
        "bg": "#0d0c0c",
        "panel": "#181616",
        "panel2": "#232120",
        "rule": "#393836",
        "edge": "#393836",
        "ink": "#c5c9c5",
        "mute": "#9a9a90",
        "user": "#87a987",
        "bot": "#7fb4ca",
        "hl": "#a292a3",
        "warn": "#e6c384",
        "bad": "#e46876",
        "info": "#7aa89f",
        "ok": "#87a987",
        "sel": "#2d4f67",
        "work": "#9cc4d4",
        "off": "#4a4844",
        "idleSignal": "#7c7972",
        "turnSignal": "#ffcf1f",
        "yel": "#ffcf1f",
        "yelink": "#14161c",
        "brandred": "#e0301e",
        "maskrim": "#f3ecd8",
        "robotInk": {
            "purple": "#c3a0fb",
            "violet": "#b3a9fa",
            "green": "#6fdc8c",
            "orange": "#ff9e64",
            "blue": "#8fb4ff",
            "magenta": "#f08af0",
            "steel": "#aab7cc"
        },
        "spriteInk": {
            "ragdoll": "#7aa2f7",
            "ginger": "#ff9e64",
            "tuxedo": "#d9dce6",
            "fox": "#ff8a4c"
        }
    },
    "gruvbox": {
        "bg": "#1d2021",
        "panel": "#282828",
        "panel2": "#32302f",
        "rule": "#504945",
        "edge": "#504945",
        "ink": "#ebdbb2",
        "mute": "#a89984",
        "user": "#b8bb26",
        "bot": "#83a598",
        "hl": "#d3869b",
        "warn": "#fabd2f",
        "bad": "#ff7a63",
        "info": "#8ec07c",
        "ok": "#b8bb26",
        "sel": "#504945",
        "work": "#8ec07c",
        "off": "#504945",
        "idleSignal": "#8c8179",
        "turnSignal": "#ffcf1f",
        "yel": "#ffcf1f",
        "yelink": "#14161c",
        "brandred": "#e0301e",
        "maskrim": "#f3ecd8",
        "robotInk": {
            "purple": "#c3a0fb",
            "violet": "#b3a9fa",
            "green": "#6fdc8c",
            "orange": "#ff9e64",
            "blue": "#8fb4ff",
            "magenta": "#f08af0",
            "steel": "#aab7cc"
        },
        "spriteInk": {
            "ragdoll": "#7aa2f7",
            "ginger": "#ff9e64",
            "tuxedo": "#d9dce6",
            "fox": "#ff8a4c"
        }
    },
    "dracula": {
        "bg": "#21222c",
        "panel": "#282a36",
        "panel2": "#343746",
        "rule": "#44475a",
        "edge": "#44475a",
        "ink": "#f8f8f2",
        "mute": "#a9b4e6",
        "user": "#50fa7b",
        "bot": "#bd93f9",
        "hl": "#ff79c6",
        "warn": "#f1fa8c",
        "bad": "#ff8585",
        "info": "#8be9fd",
        "ok": "#50fa7b",
        "sel": "#44475a",
        "work": "#8be9fd",
        "off": "#565a74",
        "idleSignal": "#858ba8",
        "turnSignal": "#ffcf1f",
        "yel": "#ffcf1f",
        "yelink": "#14161c",
        "brandred": "#e0301e",
        "maskrim": "#f3ecd8",
        "robotInk": {
            "purple": "#c3a0fb",
            "violet": "#b3a9fa",
            "green": "#6fdc8c",
            "orange": "#ff9e64",
            "blue": "#8fb4ff",
            "magenta": "#f08af0",
            "steel": "#aab7cc"
        },
        "spriteInk": {
            "ragdoll": "#7aa2f7",
            "ginger": "#ff9e64",
            "tuxedo": "#d9dce6",
            "fox": "#ff8a4c"
        }
    },
    "terminalPaper": {
        "bg": "#f3ecd9",
        "panel": "#f3ecd9",
        "panel2": "#ffffff",
        "rule": "#dbd9d3",
        "edge": "#14161c",
        "ink": "#14161c",
        "mute": "#5b5850",
        "user": "#1d6b3f",
        "bot": "#0a5a73",
        "hl": "#6b3a8a",
        "warn": "#7a4f00",
        "bad": "#b01f0c",
        "info": "#0a5a73",
        "ok": "#1d6b3f",
        "sel": "rgba(255, 207, 31, .6)",
        "work": "#6f6a5e",
        "off": "#cfc7b0",
        "idleSignal": "#827b69",
        "turnSignal": "#9c7b00",
        "yel": "#ffcf1f",
        "yelink": "#14161c",
        "brandred": "#e0301e",
        "maskrim": "#14161c",
        "robotInk": {
            "purple": "#6a3fc2",
            "violet": "#5646c4",
            "green": "#1d6b3f",
            "orange": "#a8480f",
            "blue": "#2f55c4",
            "magenta": "#9a1f9a",
            "steel": "#475670"
        },
        "spriteInk": {
            "ragdoll": "#2f55c4",
            "ginger": "#a8480f",
            "tuxedo": "#14161c",
            "fox": "#a83a0c"
        }
    }
} as const;
export type DeskTheme = keyof typeof deskThemes;

// C16 reuses the desk's palette owner rather than copying the Konsole colours.
export const terminalPalettes = {
    tokyo: deskThemes.tokyo,
    kanagawa: deskThemes.kanagawa,
    gruvbox: deskThemes.gruvbox,
    dracula: deskThemes.dracula,
    terminalPaper: deskThemes.terminalPaper,
} as const;
export type TerminalPalette = keyof typeof terminalPalettes;

export const ipPalette: Readonly<{ light: IpColours; dark: IpColours }> = {
    dark: { turnSignal: deskThemes.night.turnSignal, idleSignal: deskThemes.night.idleSignal, yellow: '#ffcf1f', red: '#e0301e', work: '#c9c2b0', off: '#3a3e49', ink: '#14161c', bone: '#f3ecd8', visor: '#ffffff', flesh: '#3b4a3f', fleshEdge: '#5c7262', paleEye: '#e8e2cf' },
    light: { turnSignal: deskThemes.paper.turnSignal, idleSignal: deskThemes.paper.idleSignal, yellow: '#ffcf1f', red: '#c9230f', work: '#6f6a5e', off: '#cfc7b0', ink: '#14161c', bone: '#14161c', visor: '#ffffff', flesh: '#55695a', fleshEdge: '#2f3b33', paleEye: '#f3ecd8' },
};

export const spriteColours = {
    "ragdoll": {
        "*": "#ffffff",
        "f": "#efe4cf",
        "p": "#5b4030",
        "m": "#5b4030",
        "w": "#fbf6ea",
        "n": "#2b1d16",
        "e": "#62a8ff",
        "x": "#f3ecd8",
        "l": "#f3ecd8"
    },
    "ginger": {
        "*": "#ffffff",
        "f": "#e8893a",
        "p": "#f5b9a6",
        "w": "#f8e2c6",
        "n": "#e2687a",
        "s": "#a5501b",
        "e": "#6fd18a",
        "x": "#14161c",
        "l": "#14161c"
    },
    "tuxedo": {
        "*": "#ffffff",
        "f": "#2b2e37",
        "p": "#e98fa0",
        "w": "#f4f1ea",
        "n": "#e98fa0",
        "e": "#6fd18a",
        "x": "#f3ecd8",
        "l": "#f3ecd8"
    },
    "fox": {
        "*": "#ffffff",
        "f": "#e0782c",
        "k": "#2b1d16",
        "p": "#f6c7a8",
        "w": "#fbf6ea",
        "n": "#14161c",
        "e": "#14161c",
        "x": "#14161c",
        "l": "#14161c"
    },
    "ipdroid": {
        "*": "#ffffff",
        "Y": "#aa5af1",
        "y": "#6a28b0",
        "h": "#e0c4ff",
        "k": "#14161c",
        "e": "#2a3350",
        "w": "#ffffff"
    },
    "ipb": {
        "*": "#ffffff",
        "k": "#14161c",
        "K": "#4f5f8f",
        "w": "#ffffff",
        "v": "#b9c3dc",
        "C": "#3f7cf5",
        "c": "#a9c6ff",
        "D": "#1d3a8a"
    },
    "cxprompt": {
        "*": "#ffffff",
        "g": "#23955a",
        "h": "#c4efd3",
        "s": "#12613a",
        "G": "#0b1f14",
        "p": "#0b1f14"
    },
    "cxloupe": {
        "*": "#ffffff",
        "V": "#1f8a4c",
        "h": "#8fe0ae",
        "s": "#12613a",
        "G": "#0b1f14",
        "r": "#d6f5e0"
    },
    "cxlab": {
        "*": "#ffffff",
        "V": "#1f8a4c",
        "h": "#8fe0ae",
        "s": "#12613a",
        "G": "#0b1f14",
        "r": "#d6f5e0",
        "g": "#0f3322",
        "w": "#ffffff"
    }
} as const;

/** O is the outline and L the lamp/eye; both always follow the work state. */
export const spriteStateTokens = { turn: 'yel', stuck: 'bad', working: 'work', waiting: 'work', idle: 'off' } as const satisfies Readonly<Record<Bulb, keyof typeof deskThemes.night>>;

export type SpriteTheme = typeof deskThemes[keyof typeof deskThemes];
const spriteRobots = { ipdroid: 'droid', ipb: 'b', cxprompt: 'prompt', cxloupe: 'loupe', cxlab: 'lab' } as const satisfies Partial<Record<SpriteKind, RobotVariant>>;

/** The external cue has page contrast; brand-yellow outlines retain the approved ATR-32 colours. */
export function spriteSignalColour(theme: SpriteTheme, bulb: Bulb): string {
    return bulb === 'turn' ? theme.turnSignal : bulb === 'idle' ? theme.idleSignal : theme[spriteStateTokens[bulb]];
}

export function spritePixelColour(theme: SpriteTheme, kind: SpriteKind, bulb: Bulb, pixel: string, preset?: RobotPreset): string {
    if (pixel === 'O' || pixel === 'L') return theme[spriteStateTokens[bulb]];
    if (kind in spriteRobots) {
        const robotKind = kind as keyof typeof spriteRobots;
        const roles: Readonly<Record<string, RobotPaintRole>> = robotPaintMap[robotKind];
        const role = roles[pixel];
        if (role) return robotPresets[preset ?? robotColourDefaults[spriteRobots[robotKind]]][role];
    } else if (pixel === 'e' || (pixel === 'x' && bulb === 'stuck')) {
        return theme[spriteStateTokens[bulb]];
    }
    const colours: Readonly<Record<string, string>> = spriteColours[kind];
    return colours[pixel];
}

export function spriteAsciiColour(theme: SpriteTheme, kind: SpriteKind, preset?: RobotPreset): string {
    if (kind in spriteRobots) return theme.robotInk[preset ?? robotColourDefaults[spriteRobots[kind as keyof typeof spriteRobots]]];
    return theme.spriteInk[kind as keyof typeof theme.spriteInk];
}
