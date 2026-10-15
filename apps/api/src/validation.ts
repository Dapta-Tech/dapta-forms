import { BadRequestException } from '@nestjs/common';
import { ZodError } from 'zod';

/**
 * One problem with a request body, shaped so a caller (an agent, most of all)
 * can fix every problem of a request in one attempt instead of one per retry.
 */
export interface ValidationIssue {
  /**
   * Dot path inside the request BODY, numbers being array positions:
   * `config.steps.2.question` is the question of the body's third step. Empty
   * for a problem with the body as a whole.
   */
  path: string;
  message: string;
  /** zod's own issue code (`invalid_type`, `too_big`, …) or one of ours (`UNSUPPORTED_FIELD`, …). */
  code: string;
}

/**
 * Issue codes that name the whole refusal: a 400 carrying one answers with it
 * as `error` (and leads with it) instead of the generic BAD_REQUEST, because
 * it is the one a caller must fix before the rest means anything.
 */
const HEADLINE_CODES: ReadonlySet<string> = new Set(['STEPS_REQUIRED']);

export function dotPath(path: ReadonlyArray<string | number>): string {
  return path.map(String).join('.');
}

export function zodIssues(err: ZodError): ValidationIssue[] {
  return err.issues.map((issue) => ({
    path: dotPath(issue.path),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * The 400 for a list of issues: `{ error, message, issues }`. `message` is the
 * first issue's, which is what every validation 400 answered before `issues`
 * existed, so a client reading only `message` sees no change.
 */
export function validationError(issues: ValidationIssue[]): BadRequestException {
  const ordered = [
    ...issues.filter((i) => HEADLINE_CODES.has(i.code)),
    ...issues.filter((i) => !HEADLINE_CODES.has(i.code)),
  ];
  const headline = ordered[0] && HEADLINE_CODES.has(ordered[0].code) ? ordered[0].code : 'BAD_REQUEST';
  return new BadRequestException({ error: headline, message: ordered[0]?.message, issues: ordered });
}

/**
 * Parse a request body, or answer 400 with EVERY problem: the schema's own,
 * followed by `extra` (rules the schema cannot express, such as the stricter
 * ones an API key is held to). A body the schema accepts but `extra` refuses is
 * refused too.
 */
export function parse<T>(
  schema: { parse: (v: unknown) => T },
  body: unknown,
  extra: ValidationIssue[] = [],
): T {
  let value: T | undefined;
  let issues: ValidationIssue[] = [];
  try {
    value = schema.parse(body);
  } catch (err) {
    if (!(err instanceof ZodError)) throw err;
    issues = zodIssues(err);
  }
  issues = [...issues, ...extra];
  if (issues.length > 0) throw validationError(issues);
  return value as T;
}
