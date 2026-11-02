import { t } from '@/text';

/**
 * Characters that change how text reads without being seen: controls (newline and tab aside),
 * format characters (bidi overrides and isolates, zero-width spaces and joiners, BOM, soft hyphen,
 * tags), line and paragraph separators, every space but U+0020, and the few letters and marks that
 * render blank (Hangul fillers, braille blank, grapheme joiner, variation selectors).
 */
const INVISIBLE =
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}\u034F\u115F\u1160\u17B4\u17B5\u2800\u3164\uFE00-\uFE0F\uFFA0\u{E0100}-\u{E01EF}]/gu;

/** Three or more blank lines in a row (spaces and tabs count as blank). */
const BLANK_LINE_RUN = /\n(?:[ \t]*\n){3,}/g;

/**
 * Forty or more spaces or tabs in a row: wider than any ordinary indentation, and enough to wrap
 * the rest of a line below the fold of a narrow card.
 */
const BLANK_RUN = /[ \t]{40,}/g;

function escapeInvisible(char: string): string {
    if (char === '\n' || char === '\t' || char === ' ') return char;
    const code = char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
    return `\u27E8U+${code}\u27E9`;
}

/**
 * Text from an agent's request, made to read as it is: every invisible character becomes a visible
 * escape such as `U+202E` in angle brackets, and floods of blank lines or spaces collapse to a count, so nothing
 * hides after them. For display only; the request itself is answered by id and never altered.
 */
export function displayText(text: string): string {
    return text
        .replace(INVISIBLE, escapeInvisible)
        .replace(BLANK_LINE_RUN, (run) => {
            const count = run.split('\n').length - 2;
            return `\n\u27E8${t('ignorePrevious.waiting.blankLines', { count })}\u27E9\n`;
        })
        .replace(BLANK_RUN, (run) => ` \u27E8${t('ignorePrevious.waiting.blankCharacters', { count: run.length })}\u27E9 `);
}
