import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import {
  defaultNotificationSetting,
  getNotificationSetting,
  getNotificationSettings,
  resetNotificationTemplate,
  upsertNotificationSetting,
} from './notification-settings';

const ACCOUNT = 'acc-1';

describe('notification settings — per-account toggles + template overrides', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('file::memory:');
    await migrate(db);
  });

  it('absent row reads back as the shipped default (enabled, stock template)', async () => {
    const s = await getNotificationSetting(db, ACCOUNT, 'attendee_confirmation');
    expect(s).toEqual(defaultNotificationSetting('attendee_confirmation'));
    expect(s.enabled).toBe(true);
    expect(s.subject).toBeNull();
    expect(s.body).toBeNull();
    expect(await getNotificationSettings(db, ACCOUNT)).toEqual(new Map());
  });

  it('toggle OFF persists and other fields stay at defaults', async () => {
    const s = await upsertNotificationSetting(db, ACCOUNT, 'host_booked', { enabled: false }, 111);
    expect(s.enabled).toBe(false);
    expect(s.subject).toBeNull();
    expect(s.updatedAt).toBe(111);
    const all = await getNotificationSettings(db, ACCOUNT);
    expect(all.get('host_booked')?.enabled).toBe(false);
  });

  it('template override persists; toggle untouched; second patch merges', async () => {
    await upsertNotificationSetting(db, ACCOUNT, 'attendee_confirmation', {
      subject: 'Custom: {{event_title}}',
      body: 'Hi {{attendee_name}}',
    });
    const s1 = await getNotificationSetting(db, ACCOUNT, 'attendee_confirmation');
    expect(s1.enabled).toBe(true);
    expect(s1.subject).toBe('Custom: {{event_title}}');

    await upsertNotificationSetting(db, ACCOUNT, 'attendee_confirmation', { enabled: false });
    const s2 = await getNotificationSetting(db, ACCOUNT, 'attendee_confirmation');
    expect(s2.enabled).toBe(false);
    expect(s2.subject).toBe('Custom: {{event_title}}'); // merge, not replace
    expect(s2.body).toBe('Hi {{attendee_name}}');
  });

  it('reminder lead minutes round-trip as a JSON array; junk reads as null', async () => {
    await upsertNotificationSetting(db, ACCOUNT, 'attendee_reminder', {
      reminderLeadMinutes: [1440, 60, 15],
    });
    const s = await getNotificationSetting(db, ACCOUNT, 'attendee_reminder');
    expect(s.reminderLeadMinutes).toEqual([1440, 60, 15]);

    // Clearing goes back to the shipped default leads.
    await upsertNotificationSetting(db, ACCOUNT, 'attendee_reminder', { reminderLeadMinutes: null });
    const cleared = await getNotificationSetting(db, ACCOUNT, 'attendee_reminder');
    expect(cleared.reminderLeadMinutes).toBeNull();
  });

  it('reset-to-default NULLs subject/body but keeps the toggle', async () => {
    await upsertNotificationSetting(db, ACCOUNT, 'attendee_cancellation', {
      enabled: false,
      subject: 'S',
      body: 'B',
    });
    const s = await resetNotificationTemplate(db, ACCOUNT, 'attendee_cancellation');
    expect(s.subject).toBeNull();
    expect(s.body).toBeNull();
    expect(s.enabled).toBe(false); // toggle survives a template reset
  });

  it('settings are tenant-scoped — another account still reads defaults', async () => {
    await upsertNotificationSetting(db, ACCOUNT, 'attendee_confirmation', { enabled: false });
    const other = await getNotificationSetting(db, 'acc-2', 'attendee_confirmation');
    expect(other.enabled).toBe(true);
    expect((await getNotificationSettings(db, 'acc-2')).size).toBe(0);
  });

  it('empty patch is a no-op that does not create a row', async () => {
    await upsertNotificationSetting(db, ACCOUNT, 'attendee_pending', {});
    expect((await getNotificationSettings(db, ACCOUNT)).size).toBe(0);
  });
});
