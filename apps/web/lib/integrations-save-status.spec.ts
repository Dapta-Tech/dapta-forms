// @vitest-environment happy-dom
/**
 * The editor's topbar and the Connect tab's pill must not disagree. With the
 * API down the tab said the integrations were not saved while the topbar kept
 * a green "Saved": the topbar now shows the worse of the two saves.
 */
import { describe, expect, it } from 'vitest';
import { publishIntegrationsSave, readIntegrationsSave, worseSaveStatus } from './integrations-save-status';

describe('two saves, one indicator', () => {
  it('lets a failed integrations save outrank a saved form', () => {
    expect(worseSaveStatus('saved', 'error')).toBe('error');
    expect(worseSaveStatus('saved', 'retrying')).toBe('retrying');
    expect(worseSaveStatus('saving', 'saved')).toBe('saving');
    // A conflict is the one the person has to act on: it outranks an error.
    expect(worseSaveStatus('conflict', 'error')).toBe('conflict');
    expect(worseSaveStatus('saved', undefined)).toBe('saved');
  });

  it('keeps the last integrations state per form, until a later save replaces it', () => {
    publishIntegrationsSave('form-a', { status: 'error', detail: 'down' });
    expect(readIntegrationsSave('form-a')).toEqual({ status: 'error', detail: 'down' });
    expect(readIntegrationsSave('form-b')).toBeUndefined();
    publishIntegrationsSave('form-a', { status: 'saved', detail: null });
    expect(readIntegrationsSave('form-a')?.status).toBe('saved');
  });
});
