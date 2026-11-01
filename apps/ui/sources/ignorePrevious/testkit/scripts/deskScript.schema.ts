import { z } from 'zod';

/**
 * The shape of a desk scenario script: the sessions a desk starts with and what happens to them
 * over time. Every time in a script is milliseconds from the scenario's start (t0); the driver
 * turns them into clock times.
 */

const offset = z.number().finite();

export const DeskRequestSchema = z.strictObject({
    tool: z.string().min(1),
    arguments: z.unknown().optional(),
    kind: z.string().optional(),
    /** Defaults to the time the request lands. */
    createdAt: offset.optional(),
});

export const DeskPatchSchema = z.strictObject({
    active: z.boolean().optional(),
    thinking: z.boolean().optional(),
    activeAt: offset.optional(),
    thinkingAt: offset.optional(),
    updatedAt: offset.optional(),
    createdAt: offset.optional(),
    pendingRequestObservedAt: offset.optional(),
    latestTurnStatusObservedAt: offset.optional(),
    pendingPermissionRequestCount: z.number().int().nonnegative().optional(),
    pendingUserActionRequestCount: z.number().int().nonnegative().optional(),
    archivedAt: offset.nullable().optional(),
    /** Merged over the session's metadata. */
    metadata: z.record(z.string(), z.unknown()).optional(),
    /** A request id mapped to null is answered elsewhere and leaves the pending list. */
    requests: z.record(z.string(), DeskRequestSchema.nullable()).optional(),
    /** Moves a pending request to the completed list with this outcome. */
    completed: z.record(z.string(), z.enum(['approved', 'denied', 'canceled'])).optional(),
});

export const DeskScriptSessionSchema = z.strictObject({
    id: z.string().min(1),
    /** Shown as the session's summary title. */
    title: z.string(),
    path: z.string().min(1),
    /** Informational only: the desk works out the coordinator itself. */
    role: z.enum(['coordinator', 'worker']).optional(),
    /** Only the sidebar's list row has loaded, not the full record (cold load). */
    listOnly: z.boolean().optional(),
    initial: DeskPatchSchema.optional(),
});

export const DeskStepSchema = z
    .strictObject({
        at: z.number().finite().nonnegative(),
        id: z.string().min(1),
        patch: DeskPatchSchema.optional(),
        /** An echo older than what the store holds: the store must ignore it. */
        late: z.boolean().optional(),
        /** The full record of a list-only session arrives. */
        hydrate: z.boolean().optional(),
    })
    .refine((step) => step.patch !== undefined || step.hydrate === true, { message: 'a step needs a patch or hydrate' });

export const DeskScriptSchema = z
    .strictObject({
        id: z.string().optional(),
        /** The board items this script reproduces (F1, W2 ...). */
        covers: z.array(z.string().min(1)).min(1),
        /** Clock time of the scenario's start; a fixed default keeps runs identical. */
        t0: z.number().int().positive().optional(),
        sessions: z.array(DeskScriptSessionSchema).min(1),
        steps: z.array(DeskStepSchema).default([]),
    })
    .superRefine((script, ctx) => {
        const ids = new Set(script.sessions.map((session) => session.id));
        script.steps.forEach((step, index) => {
            if (!ids.has(step.id)) {
                ctx.addIssue({ code: 'custom', path: ['steps', index, 'id'], message: `no session ${step.id}` });
            }
        });
    });

export type DeskRequest = z.output<typeof DeskRequestSchema>;
export type DeskPatch = z.output<typeof DeskPatchSchema>;
export type DeskScriptSession = z.output<typeof DeskScriptSessionSchema>;
export type DeskStep = z.output<typeof DeskStepSchema>;
export type DeskScript = z.output<typeof DeskScriptSchema>;
