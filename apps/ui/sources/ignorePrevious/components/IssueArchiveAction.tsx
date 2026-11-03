import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { t } from '@/text';

import { archiveIssueSessions } from '../model/archiveIssueSessions';
import type { IssueArchiveState } from '../model/issueArchive';
import type { WorkerRow } from '../model/groupWorkers';
import { useDeskPaint } from '../palette';
import { DeskText } from '../typography/DeskText';

export function IssueArchiveAction({ issueKey, model, workers, knownProjectCodes }: {
    issueKey: string;
    model: IssueArchiveState;
    workers: readonly WorkerRow[];
    knownProjectCodes?: ReadonlySet<string>;
}) {
    const { paint } = useDeskPaint();
    const [busy, setBusy] = React.useState(false);
    const inFlight = React.useRef(false);
    const [failedNames, setFailedNames] = React.useState<readonly string[]>([]);
    const archive = async () => {
        if (inFlight.current || !model.canArchive) return;
        inFlight.current = true;
        setBusy(true);
        setFailedNames([]);
        try {
            const failed = await archiveIssueSessions(issueKey, knownProjectCodes);
            setFailedNames(failed.map(id => workers.find(worker => worker.sessionId === id)?.title ?? id));
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    };
    if (!model.canArchive && !busy && failedNames.length === 0) return null;
    return (
        <View style={{ gap: 4, paddingHorizontal: 12, paddingBottom: 8 }}>
            {model.canArchive || busy ? <Pressable
                testID={`ip-issue-archive-${issueKey}`}
                accessibilityRole="button"
                accessibilityLabel={t('ignorePrevious.archiveIssue.label', { key: issueKey })}
                accessibilityState={{ busy, disabled: busy }}
                disabled={busy}
                onPress={archive}
                style={{ alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 8, minHeight: Platform.select({ ios: 44, android: 48, default: 28 }) }}
            >
                <DeskText style={{ color: paint.mute, fontSize: 13 }}>{t(busy ? 'ignorePrevious.archiveIssue.busy' : 'ignorePrevious.archiveIssue.button')}</DeskText>
            </Pressable> : null}
            {failedNames.length > 0 ? <DeskText
                testID={`ip-issue-archive-error-${issueKey}`}
                accessibilityRole="alert"
                style={{ color: paint.bad, fontSize: 13 }}
            >{t('ignorePrevious.archiveIssue.failed', { names: failedNames.join(', ') })}</DeskText> : null}
        </View>
    );
}
