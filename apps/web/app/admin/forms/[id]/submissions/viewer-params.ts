/**
 * The submissions viewer's state in the address bar, shared by the server page
 * (which reads it on load) and the client viewer (which rewrites it). Kept out
 * of the `'use client'` module on purpose: a server component that imports a
 * constant from a client module gets a client reference, not the string.
 */

/** `?response=`: the response open in the panel, so it survives a reload and can be shared. */
export const RESPONSE_PARAM = 'response';

/** `?view=sheet`: the table as a full-screen sheet, kept across a reload and a page change. */
export const VIEW_PARAM = 'view';
export const SHEET_VIEW = 'sheet';
