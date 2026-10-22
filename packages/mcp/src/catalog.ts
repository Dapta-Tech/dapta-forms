import { PARITY_TOOLS } from './parity/index';
import { TOOLS, type ToolDef } from './tools';

/**
 * Every tool the server registers, in this order: the task-shaped core
 * (`TOOLS`), then one tool for each remaining route of the public API
 * reference (`PARITY_TOOLS`). Kept apart from `tools.ts` because the parity
 * tools reuse its shapes, and a module cannot import what imports it.
 */
export const CATALOG: readonly ToolDef[] = [...TOOLS, ...PARITY_TOOLS];
