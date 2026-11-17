// @vitest-environment happy-dom
/**
 * The editor's topbar and the Connect tab's pill must not disagree. With the
 * API down the tab said the integrations were not saved while the topbar kept
 * a green "Saved": the topbar now shows the worse of the two saves.
 */
import { describe, expect, it } from 'vitest';
import {
  acknowledgeLostIntegrationsSave,
  markLostSaveAnnounced,
  publishFormSave,
  publishIntegrationsSave,
  readCombinedSave,
  readIntegrationsSave,
  saveStatusReason,
  setConnectTabOpen,
  worseSaveStatus,
} from './integrations-save-status';

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

describe('the reason under the topbar indicator', () => {
  it('names both saves when both are at the state shown', () => {
    expect(
      saveStatusReason('error', { status: 'error', detail: 'draft refused' }, { status: 'error', detail: 'webhook down' }),
    ).toBe('draft refused · webhook down');
  });

  it('names only the save that is at the state shown', () => {
    expect(saveStatusReason('error', { status: 'saved', detail: null }, { status: 'error', detail: 'webhook down' })).toBe(
      'webhook down',
    );
    expect(saveStatusReason('error', { status: 'error', detail: 'draft refused' }, { status: 'saved' })).toBe(
      'draft refused',
    );
    expect(saveStatusReason('saved', { status: 'saved', detail: null }, { status: 'saved' })).toBeNull();
  });
});

/**
 * `partial` says a CARD on the Connect tab was left out of the save (a
 * webhook switched on with no URL). It used to sit on the topbar for as long
 * as the author stayed away from that tab, over the builder's own "Saving"
 * and "Saved". Away from Connect the topbar speaks for the builder alone; the
 * condition stays on record (the Connect tab's label is marked from it).
 */
describe('a card left out of the save, away from the Connect tab', () => {
  it('is the save state while the tab is open, and not once the author is elsewhere', () => {
    setConnectTabOpen('p1', true);
    publishIntegrationsSave('p1', { status: 'partial', detail: 'Saved everything except the webhook.' });
    expect(readCombinedSave('p1')).toMatchObject({ status: 'partial', detail: 'Saved everything except the webhook.' });

    setConnectTabOpen('p1', false);
    // The builder saves fine: that is what the topbar says now.
    expect(readCombinedSave('p1')).toMatchObject({ status: 'saved', detail: null });
    publishFormSave('p1', { status: 'saving', detail: null });
    expect(readCombinedSave('p1').status).toBe('saving');
    publishFormSave('p1', { status: 'saved', detail: null });
    expect(readCombinedSave('p1').status).toBe('saved');
    // Still true, and still known: it did not vanish, it moved to the tab's label.
    expect(readIntegrationsSave('p1')).toMatchObject({ status: 'partial' });

    setConnectTabOpen('p1', true);
    expect(readCombinedSave('p1').status).toBe('partial');
    setConnectTabOpen('p1', false);
  });

  it('does not hide a failed save or a lost change: that is unsaved work wherever the author is', () => {
    publishIntegrationsSave('p2', { status: 'error', detail: 'down' });
    expect(readCombinedSave('p2').status).toBe('error');
    publishIntegrationsSave('p2', { status: 'error', detail: 'lost', lost: true });
    expect(readCombinedSave('p2')).toMatchObject({ status: 'error', lost: true });
  });
});

describe('a lost change is acknowledged, not nagged about', () => {
  it('is marked as announced once, and stays an error until it is dismissed', () => {
    publishIntegrationsSave('l1', { status: 'error', detail: 'lost', lost: true });
    expect(readIntegrationsSave('l1')?.announced).toBeFalsy();
    markLostSaveAnnounced('l1');
    expect(readIntegrationsSave('l1')).toMatchObject({ status: 'error', lost: true, announced: true });
    expect(readCombinedSave('l1')).toMatchObject({ status: 'error', lost: true });
    acknowledgeLostIntegrationsSave('l1');
    expect(readIntegrationsSave('l1')).toEqual({ status: 'saved' });
    expect(readCombinedSave('l1')).toMatchObject({ status: 'saved', lost: false });
  });

  it('cannot wave away a save that is failing right now', () => {
    publishIntegrationsSave('l2', { status: 'error', detail: 'down' });
    acknowledgeLostIntegrationsSave('l2');
    expect(readIntegrationsSave('l2')).toMatchObject({ status: 'error' });
  });

  it('a NEW lost change is announced again', () => {
    publishIntegrationsSave('l3', { status: 'error', detail: 'lost', lost: true });
    markLostSaveAnnounced('l3');
    publishIntegrationsSave('l3', { status: 'saving' });
    publishIntegrationsSave('l3', { status: 'error', detail: 'lost', lost: true });
    expect(readIntegrationsSave('l3')?.announced).toBeFalsy();
  });
});
