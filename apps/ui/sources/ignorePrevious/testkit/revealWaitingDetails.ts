import { pressTestInstanceAsync } from '@/dev/testkit';
import type { RenderScreenResult } from '@/dev/testkit/render/renderScreen';

/** Detail/safety suites explicitly open each request through its real disclosure control. */
export async function revealWaitingDetails(screen: Pick<RenderScreenResult, 'tree'>) {
    const toggles = screen.tree.root.findAll(node => typeof node.type === 'string'
        && typeof node.props.testID === 'string' && node.props.testID.startsWith('ip-waiting-toggle-')
        && node.props.accessibilityState?.expanded === false);
    for (const toggle of toggles) await pressTestInstanceAsync(toggle);
}
