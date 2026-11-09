/**
 * The stable code the API refuses "turn the attribution off" with when the
 * workspace has no paid verdict (`apps/api/src/attribution.service.ts`). A
 * plain module: a `'use server'` file may only export async functions.
 */
export const DAPTA_SUBSCRIPTION_REQUIRED = 'DAPTA_SUBSCRIPTION_REQUIRED';
