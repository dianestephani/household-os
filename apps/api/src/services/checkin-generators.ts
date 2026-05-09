import { CheckIn } from '../db/models/CheckIn.js';
import { createCheckIn } from './checkins.js';
import { frequentDeferrals, workoutSummary } from './patterns.js';
import { todaysWorkout } from './workouts.js';
import { pickNextZone } from './zones.js';
import { pushCheckInCard } from './alexa-push.js';
import { ymd } from '../utils/dates.js';
import type {
  CheckInQuestion,
  CheckInType,
} from '@household-os/shared/types';

const MOOD_CHOICES = [
  { value: 'good', label: '😀 good' },
  { value: 'neutral', label: '😐 neutral' },
  { value: 'down', label: '😞 down' },
];

const ENERGY_CHOICES = [
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
];

/**
 * Returns the most recent pending or answered CheckIn of a given type whose
 * `scheduled_for` falls on a particular YYYY-MM-DD. Used to prevent duplicate
 * generation when a cron runs more than once per day.
 */
async function existingForDay(type: CheckInType, date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return CheckIn.findOne({
    type,
    scheduled_for: { $gte: start, $lt: end },
  }).lean();
}

export async function generateMorningIntent(now = new Date()) {
  const existing = await existingForDay('morning_intent', now);
  if (existing) return existing;

  const questions: CheckInQuestion[] = [
    {
      id: 'one_thing_today',
      text: "What's the one thing you want to land today?",
      type: 'text',
    },
    {
      id: 'energy',
      text: 'How is your energy?',
      type: 'energy',
      choices: ENERGY_CHOICES,
      side_effect: 'log_energy',
    },
    {
      id: 'mood',
      text: 'How is your mood?',
      type: 'mood',
      choices: MOOD_CHOICES,
      side_effect: 'log_mood',
    },
  ];
  const ck = await createCheckIn({
    type: 'morning_intent',
    scheduled_for: now,
    questions,
  });
  await pushCheckInCard(ck);
  return ck;
}

export async function generateEveningRetro(now = new Date()) {
  const existing = await existingForDay('evening_retro', now);
  if (existing) return existing;

  const questions: CheckInQuestion[] = [
    {
      id: 'what_skipped',
      text: 'Anything skip today? Why?',
      type: 'text',
    },
    {
      id: 'tomorrow_adjust',
      text: 'Anything to adjust for tomorrow?',
      type: 'text',
    },
  ];
  return createCheckIn({
    type: 'evening_retro',
    scheduled_for: now,
    questions,
  });
}

export async function generateWeeklyReview(now = new Date()) {
  const existing = await existingForDay('weekly_review', now);
  if (existing) return existing;

  const [deferrals, workouts] = await Promise.all([
    frequentDeferrals(7, 2),
    workoutSummary(7),
  ]);

  const summary = [
    `Last 7 days: ${workouts.done} workouts done, ${workouts.skipped} skipped, ${workouts.partial} partial.`,
    deferrals.length > 0
      ? `Repeated deferrals: ${deferrals
          .slice(0, 3)
          .map((d) => `${d.routine_name} (${d.count}×)`)
          .join(', ')}.`
      : 'No repeated deferrals this week.',
  ].join(' ');

  const questions: CheckInQuestion[] = [
    {
      id: 'weekly_summary',
      text: summary,
      type: 'text',
      answer: '__readonly__',
    },
    {
      id: 'routines_working',
      text: 'Are routines still working as-is?',
      type: 'choice',
      choices: [
        { value: 'yes', label: 'Yes' },
        { value: 'mostly', label: 'Mostly' },
        { value: 'no', label: 'No — need to adjust' },
      ],
    },
    {
      id: 'cadence_adjust',
      text: 'Anything to adjust? (cadence, drop, add, etc.)',
      type: 'text',
    },
  ];
  return createCheckIn({
    type: 'weekly_review',
    scheduled_for: now,
    questions,
  });
}

/**
 * Generate one pattern_interrupt CheckIn per detected pattern (frequent
 * deferrals + skipped workouts). Idempotent within the same calendar day per
 * (kind, routine_key) to avoid stacking.
 */
export async function generatePatternInterrupts(now = new Date()) {
  const created: unknown[] = [];

  const deferrals = await frequentDeferrals(14, 3);
  for (const d of deferrals) {
    const dupe = await CheckIn.findOne({
      type: 'pattern_interrupt',
      'context.kind': 'frequent_deferral',
      'context.routine_key': d.routine_key,
      scheduled_for: { $gte: dayStart(now), $lt: dayEnd(now) },
    }).lean();
    if (dupe) continue;

    const ck = await createCheckIn({
      type: 'pattern_interrupt',
      scheduled_for: now,
      context: {
        kind: 'frequent_deferral',
        routine_key: d.routine_key,
        routine_name: d.routine_name,
        count: d.count,
        window_days: d.window_days,
      },
      questions: [
        {
          id: 'deferral_action',
          text: `${d.routine_name} has been deferred ${d.count} times in the last ${d.window_days} days. What do you want to do?`,
          type: 'choice',
          choices: [
            { value: 'push_through', label: 'Push through today' },
            { value: 'swap_today', label: 'Swap something else out for it' },
            { value: 'adjust_cadence', label: 'Adjust the cadence' },
            { value: 'skip_intentional', label: 'Skipping on purpose — leave it' },
          ],
        },
        {
          id: 'deferral_notes',
          text: 'Notes (optional)',
          type: 'text',
        },
      ],
    });
    await pushCheckInCard(ck);
    created.push(ck);
  }

  // Workout interrupt: if today is a workout day and there's already a skipped
  // streak ≥ 2 in the last 7 days, ask about today's slot.
  const workouts = await workoutSummary(7);
  const lastSkippedStreak = workouts.recent_streaks.find((s) => s.kind === 'skipped');
  const today = await todaysWorkout(now);
  if (
    today.slot &&
    !today.log &&
    lastSkippedStreak &&
    lastSkippedStreak.length >= 2
  ) {
    const dupe = await CheckIn.findOne({
      type: 'pattern_interrupt',
      'context.kind': 'missed_workouts',
      scheduled_for: { $gte: dayStart(now), $lt: dayEnd(now) },
    }).lean();
    if (!dupe) {
      const ck = await createCheckIn({
        type: 'pattern_interrupt',
        scheduled_for: now,
        context: {
          kind: 'missed_workouts',
          count: lastSkippedStreak.length,
          window_days: 7,
        },
        questions: [
          {
            id: 'workout_intent',
            text: `You've skipped ${lastSkippedStreak.length} workouts in a row. Today's slot: ${today.slot.name}. What's the plan?`,
            type: 'choice',
            choices: [
              { value: 'commit', label: "I'll do it" },
              { value: 'partial', label: 'Something partial' },
              { value: 'rest', label: 'Skip on purpose — rest day' },
            ],
          },
        ],
      });
      await pushCheckInCard(ck);
      created.push(ck);
    }
  }

  return created;
}

export async function generateZoneAssessment(now = new Date()) {
  const existing = await CheckIn.findOne({
    type: 'zone_assessment',
    scheduled_for: { $gte: dayStart(now), $lt: dayEnd(now) },
  }).lean();
  if (existing) return existing;

  const zone = await pickNextZone();
  const questions: CheckInQuestion[] = [
    {
      id: 'zone_state',
      text: `How is the ${zone === 'whole-house' ? 'house overall' : zone} looking?`,
      type: 'choice',
      choices: [
        { value: 'fine', label: 'Fine' },
        { value: 'meh', label: 'Meh' },
        { value: 'rough', label: 'Rough' },
      ],
    },
    {
      id: 'zone_notes',
      text: 'Anything specific that needs doing? (optional — gets auto-added)',
      type: 'text',
    },
  ];

  return createCheckIn({
    type: 'zone_assessment',
    scheduled_for: now,
    questions,
    context: { kind: 'zone_assessment', zone },
  });
}

function dayStart(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function dayEnd(d: Date) {
  const x = dayStart(d);
  x.setDate(x.getDate() + 1);
  return x;
}

void ymd; // re-exported via dates if needed elsewhere
