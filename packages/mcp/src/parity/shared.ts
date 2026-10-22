import * as z from 'zod4';
import { BackendError } from '../backend';
import type { ResponseFilter } from '../parity-backend';
import { ToolFailure } from '../support';
import { dateBound } from '../tools';

/**
 * What the tools of the rest of the API reference share: the argument shapes
 * every one of them reads the same way, the behaviour hints, and how a 404
 * is named for what the call was looking for.
 */

export const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
export const WRITE_IDEMPOTENT = { ...WRITE, idempotentHint: true } as const;
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

/** The sentence every destructive tool ends its description with. */
export const CONFIRM_FIRST =
  'Destructive: before calling it, tell the user exactly what will change or be deleted and wait for their yes. Never call it again on your own after an error or a timeout: read first.';

export const formIdArg = z.string().min(1).max(64).describe('The form id, from list_forms or get_form.');
export const responseIdArg = z.string().min(1).max(64).describe('The response id, from list_responses.');
export const folderIdArg = z.string().min(1).max(64).describe('The folder id, from list_folders.');

export const emailKeyArg = z
  .enum(['submission_received', 'submission_confirmed'])
  .describe('submission_received: the notice to the team. submission_confirmed: the receipt to the person who answered.');

/** The table's filter, as the CSV, the Summary and the answer search read it. */
export const responseFilterShape = {
  status: z
    .enum(['all', 'completed', 'partial'])
    .default('all')
    .describe('completed: reached the end. partial: left before the end, answers saved so far.'),
  from: dateBound.describe('Responses started on or after this day (YYYY-MM-DD in the workspace time zone) or epoch ms.'),
  to: dateBound.describe('Responses started on or before this day (inclusive) or epoch ms.'),
  score_min: z.number().int().optional().describe('Lowest score, inclusive. Ignored when the form does not score.'),
  score_max: z.number().int().optional().describe('Highest score, inclusive. Ignored when the form does not score.'),
  answers: z
    .record(z.string().min(1).max(64), z.array(z.string().max(500)).max(100))
    .optional()
    .describe('Choice answers to match: { "step_key": ["option value", ...] }. A response matches when it picked one of the values of every key.'),
  search: z.string().max(200).optional().describe('Free text, looked for in the written answers.'),
};

export interface ResponseFilterArgs {
  status: 'all' | 'completed' | 'partial';
  from?: string;
  to?: string;
  score_min?: number;
  score_max?: number;
  answers?: Record<string, string[]>;
  search?: string;
}

export function filterOf(args: ResponseFilterArgs): ResponseFilter {
  return {
    status: args.status,
    ...(args.from !== undefined ? { from: args.from } : {}),
    ...(args.to !== undefined ? { to: args.to } : {}),
    ...(args.score_min !== undefined ? { scoreMin: args.score_min } : {}),
    ...(args.score_max !== undefined ? { scoreMax: args.score_max } : {}),
    ...(args.answers !== undefined ? { answers: args.answers } : {}),
    ...(args.search !== undefined ? { search: args.search } : {}),
  };
}

/** What a call was looking for, and where to find a good id for it. */
export interface Missing {
  what: string;
  hint: string;
}

export const FORM_MISSING: Missing = {
  what: 'Form',
  hint: 'Check the id with list_forms. An id from another workspace is reported the same way.',
};

/**
 * Run a backend call, naming a 404 for what was looked for and adding the
 * hint of a code the call knows about. Everything else is left to the
 * server's error mapping (roles, rate limits, validation, internal errors).
 */
export async function attempt<T>(work: Promise<T>, missing: Missing, hints: Record<string, string> = {}): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof BackendError) {
      if (error.status === 404) throw new ToolFailure('NOT_FOUND', `${missing.what} not found in this workspace.`, missing.hint);
      const hint = hints[error.code];
      if (hint && error.issues.length === 0) throw new ToolFailure(error.code, error.message, hint);
    }
    throw error;
  }
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
