import * as React from 'react';
import type { WqItem } from './wqCardData';
export type DeskContextData = { items: ReadonlyMap<string, WqItem | null>; projectNames: ReadonlyMap<string, string> | undefined };
export const DeskContextDataContext = React.createContext<DeskContextData | null>(null);
export function resolveQuestionContext(text: readonly string[], data: DeskContextData | null): { issue: string; project: string } | null {
    if (!data) return null;
    const keys = new Set<string>();
    for (const part of text) {
        for (const match of part.matchAll(/(?<![A-Za-z0-9_])([A-Za-z]{2,5}-\d{1,6})(?![A-Za-z0-9_]|\.\d)/g)) keys.add(match[1].toUpperCase());
    }
    if (keys.size !== 1) return null;
    const issue = [...keys][0];
    const item = data.items.get(issue);
    const project = data.projectNames?.get(issue.slice(0, issue.indexOf('-')));
    return item?.id === issue && project ? { issue, project } : null;
}
