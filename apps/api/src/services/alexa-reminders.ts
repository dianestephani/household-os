import { AlexaReminder } from '../db/models/AlexaReminder.js';
import { getValidAccessToken } from './alexa-lwa.js';
import { logActivity } from './activity.js';

const ALEXA_API_BASE = 'https://api.amazonalexa.com';

/**
 * Alexa Proactive Reminders for §47 Phase 6a. Used by the appointment-
 * reconcile cron to nudge Diane ~24h before an appointment, and could be
 * extended later to nudge for other time-bound things.
 *
 * As with `alexa-shopping-list`, this no-ops when LWA isn't configured
 * (returns `null`) — the cron handles that gracefully.
 */

export interface CreateReminderInput {
  text: string;
  scheduledTime: Date;
  /** Foreign key linking back to the Google Calendar event we're reminding for. */
  calendarEventId: string;
  routineKey?: string;
}

export interface ReminderRecord {
  alexa_reminder_id: string;
  scheduled_at: Date;
  calendar_event_id: string;
}

export async function createReminderForAppointment(
  input: CreateReminderInput,
): Promise<ReminderRecord | null> {
  // Idempotency: if we've already created a reminder for this calendar
  // event, return the existing record rather than double-buzzing.
  const existing = await AlexaReminder.findOne({
    calendar_event_id: input.calendarEventId,
  }).lean();
  if (existing) {
    return {
      alexa_reminder_id: existing.alexa_reminder_id,
      scheduled_at: existing.scheduled_at as Date,
      calendar_event_id: existing.calendar_event_id,
    };
  }

  const creds = await getValidAccessToken();
  if (!creds) return null;

  const reminderBody = {
    requestTime: new Date().toISOString(),
    trigger: {
      type: 'SCHEDULED_ABSOLUTE',
      scheduledTime: input.scheduledTime.toISOString().replace(/\.\d{3}Z$/, ''),
      timeZoneId: process.env.TZ ?? 'America/Los_Angeles',
    },
    alertInfo: {
      spokenInfo: {
        content: [{ locale: 'en-US', text: input.text }],
      },
    },
    pushNotification: { status: 'ENABLED' },
  };

  try {
    const res = await fetch(`${ALEXA_API_BASE}/v1/alerts/reminders`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${creds.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(reminderBody),
    });
    if (!res.ok) {
      console.error(
        `[alexa-reminders] create failed: ${res.status} ${await res.text()}`,
      );
      return null;
    }
    const data = (await res.json()) as { alertToken?: string };
    if (!data.alertToken) return null;
    await AlexaReminder.create({
      calendar_event_id: input.calendarEventId,
      alexa_reminder_id: data.alertToken,
      scheduled_at: input.scheduledTime,
      routine_key: input.routineKey,
    });
    await logActivity(
      'routine_edited',
      `Created Alexa reminder for upcoming appointment`,
      {
        actor: 'cron',
        metadata: {
          surface: 'alexa_reminders',
          calendar_event_id: input.calendarEventId,
          routine_key: input.routineKey,
          scheduled_at: input.scheduledTime.toISOString(),
        },
      },
    );
    return {
      alexa_reminder_id: data.alertToken,
      scheduled_at: input.scheduledTime,
      calendar_event_id: input.calendarEventId,
    };
  } catch (err) {
    console.error('[alexa-reminders] create threw', err);
    return null;
  }
}

/**
 * Removes the local AlexaReminder record (does NOT call Amazon to delete the
 * reminder — it'll naturally expire). Used when the upstream calendar event
 * is deleted so a future reschedule can write a fresh reminder.
 */
export async function clearLocalReminderForEvent(
  calendarEventId: string,
): Promise<void> {
  await AlexaReminder.deleteOne({ calendar_event_id: calendarEventId });
}
