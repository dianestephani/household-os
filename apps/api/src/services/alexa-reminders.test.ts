import { describe, it, expect } from 'vitest';
import { AlexaReminder } from '../db/models/AlexaReminder.js';
import {
  clearLocalReminderForEvent,
  createReminderForAppointment,
} from './alexa-reminders.js';

describe('createReminderForAppointment — idempotency', () => {
  it('returns null when LWA is not configured (NODE_ENV=test)', async () => {
    const r = await createReminderForAppointment({
      text: 'heads up',
      scheduledTime: new Date('2026-06-15T15:00:00Z'),
      calendarEventId: 'evt-1',
    });
    expect(r).toBeNull();
  });

  it('returns the existing record when one already exists for the calendar event', async () => {
    // Pre-seed a record (simulating a previous successful create on a day
    // when LWA was configured).
    await AlexaReminder.create({
      calendar_event_id: 'evt-1',
      alexa_reminder_id: 'token-abc',
      scheduled_at: new Date('2026-06-15T15:00:00Z'),
      routine_key: 'head_spa',
    });

    const r = await createReminderForAppointment({
      text: 'heads up',
      scheduledTime: new Date('2026-06-15T15:00:00Z'),
      calendarEventId: 'evt-1',
    });
    expect(r?.alexa_reminder_id).toBe('token-abc');

    // Should not have duplicated
    const all = await AlexaReminder.find({}).lean();
    expect(all.length).toBe(1);
  });
});

describe('clearLocalReminderForEvent', () => {
  it('removes the local record for that calendar event', async () => {
    await AlexaReminder.create({
      calendar_event_id: 'evt-1',
      alexa_reminder_id: 'token-abc',
      scheduled_at: new Date(),
    });
    await clearLocalReminderForEvent('evt-1');
    const remaining = await AlexaReminder.find({}).lean();
    expect(remaining.length).toBe(0);
  });

  it('is a no-op when nothing matches', async () => {
    await clearLocalReminderForEvent('does-not-exist');
    // No throw is success.
  });
});
