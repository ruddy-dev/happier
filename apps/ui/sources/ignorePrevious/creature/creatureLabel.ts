import { t } from '@/text';
import type { CreatureMode } from './creatureMode';

export function creatureLabel(mode: CreatureMode, running: boolean): string {
    if (mode === 'working' && !running) return t('ignorePrevious.creature.workingStill');
    if (mode === 'burst' && !running) return t('ignorePrevious.creature.burstStill');
    return t(`ignorePrevious.creature.${mode}`);
}
