import type { ReactNode } from 'react';

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

function Section({ title, defaultOpen, children }: SectionProps) {
  return (
    <details
      open={defaultOpen}
      style={{
        borderTop: '1px solid var(--border)',
        padding: '0.75rem 0',
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          fontWeight: 600,
          padding: '0.25rem 0',
        }}
      >
        {title}
      </summary>
      <div style={{ paddingTop: '0.5rem', lineHeight: 1.55 }}>{children}</div>
    </details>
  );
}

function Cmd({ children }: { children: ReactNode }) {
  return (
    <code
      style={{
        background: 'var(--bg)',
        padding: '0.1em 0.35em',
        borderRadius: '3px',
        fontSize: '0.9em',
      }}
    >
      {children}
    </code>
  );
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  margin: '0.5rem 0',
};
const cellStyle: React.CSSProperties = {
  padding: '0.4rem 0.5rem',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'top',
  textAlign: 'left',
};
const headerCellStyle: React.CSSProperties = {
  ...cellStyle,
  background: 'var(--bg)',
  fontWeight: 600,
};

export default function HowToGuide() {
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, marginBottom: '0.5rem' }}>How to use Household OS</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Click a section to expand it. Sections are independent — skim what's relevant.
      </p>

      <Section title="Quick start" defaultOpen>
        <p>
          Three places you'll spend most of your time:
        </p>
        <ol>
          <li>
            <strong>The Today tab</strong> — see today's plan, mark items done, defer with a reason,
            log mood + energy, pull deferred items back when energy returns.
          </li>
          <li>
            <strong>The check-in banner</strong> at the top of the Today tab — a morning prompt for
            your one priority + energy/mood, an evening retro, weekly review on Sundays, and
            pattern-triggered prompts when the system notices you've been pushing something off.
          </li>
          <li>
            <strong>An Echo or the Alexa simulator</strong> — for hands-free quick logging and
            quick reads (<Cmd>Alexa, ask Home Ops what's on today</Cmd>).
          </li>
        </ol>
        <p className="muted">
          Everything else (Workouts, Activity feed, Routines editor, persona chat) is on the
          other tabs and explained below.
        </p>
      </Section>

      <Section title="Today tab">
        <p>The default landing page. Top to bottom:</p>
        <ul>
          <li>
            <strong>Check-in banner</strong> (only when one is pending) — see "Check-ins" section.
          </li>
          <li>
            <strong>Energy buttons</strong> — Low / Medium / High. Updates today's plan's energy
            field and may surface swap suggestions when energy drops.
          </li>
          <li>
            <strong>Mood buttons</strong> — 😞 down / 😐 neutral / 😀 good. Pure logging, doesn't
            change the plan.
          </li>
          <li>
            <strong>Today list</strong> — one row per scheduled item with check (mark done) and
            defer buttons. Items are ordered by priority (overdue routines, fixed-day items,
            zone-driven tasks, event-driven triggers, etc).
          </li>
          <li>
            <strong>Swap pool</strong> — items deferred today or that didn't fit the day's time
            budget. Click <em>pull in</em> to bring one back into the active list.
          </li>
        </ul>
        <p>
          Defer always opens a small dialog asking why (tired / not in the mood / out of time /
          other) — optional, but the answer feeds pattern detection.
        </p>
      </Section>

      <Section title="Workouts tab">
        <p>
          Tracks the protected workout slots from your inventory: PT Tuesday, PT Thursday, and a
          flex-day lift any other weekday.
        </p>
        <ul>
          <li>
            <strong>Today's workout</strong> shows the slot for today (if it's a workout day) and
            three buttons: Done / Partial / Skipped. Clicking logs the workout via the API.
          </li>
          <li>
            <strong>Last 14 days</strong> shows totals (done / partial / skipped) and current
            streaks.
          </li>
          <li>
            <strong>History</strong> lists recent log entries with status.
          </li>
        </ul>
        <p>
          Skipping a workout is fine. <strong>Skipping repeatedly</strong> triggers a
          pattern-interrupt check-in the next morning that asks what you want to do about it.
        </p>
      </Section>

      <Section title="Activity tab">
        <p>
          Unified chronological feed of every meaningful event — every task completed, deferred,
          swapped, every mood/energy/workout log, every zone assessment, every check-in lifecycle
          step, every plan generation. Bucketed by day (Today / Yesterday / [date]).
        </p>
        <p>
          Use the time-window selector at the top to see 3 / 7 / 14 / 30 days. Events tagged{' '}
          <Cmd>[system]</Cmd> or <Cmd>[cron]</Cmd> are non-user actions (auto-defers,
          plan generations, scheduled check-ins).
        </p>
        <p>
          This is the answer to "what did I actually do this week?" — both via the dashboard and
          via the persona chat (<Cmd>what did I do today</Cmd>).
        </p>
      </Section>

      <Section title="Household Ops tab (persona chat)">
        <p>
          Free-form conversation with Claude, configured as your Household Ops persona. The
          persona has tool access to everything the dashboard can do, plus pattern queries.
          Useful for:
        </p>
        <ul>
          <li>
            Things that don't fit a button: <em>"why did the morning plan look so small today?"</em>{' '}
            or <em>"talk me through deferring yard pickup again."</em>
          </li>
          <li>
            Pattern questions: <em>"what have I been deferring"</em> /{' '}
            <em>"how many workouts have I missed this month"</em>.
          </li>
          <li>
            Bulk edits via natural language: <em>"add a one-off task to mop the kitchen tomorrow"</em>.
          </li>
        </ul>
        <p>
          The persona is told to <strong>push back</strong> when patterns indicate trouble — if
          you've deferred a routine 4 times in 10 days, it'll flag it instead of silently
          accommodating.
        </p>
        <p>
          The Nutrition tab is still stubbed for v1. Asking it anything just returns a
          "this persona is coming later" message. The Finance tab is now real — see below.
        </p>
      </Section>

      <Section title="Finance tab">
        <p>
          Narrow scope: <strong>which household tasks can I afford to outsource right now?</strong>{' '}
          The system stores a single monthly profile (income + fixed expenses → discretionary)
          and per-routine outsourcing cost estimates. RocketMoney stays your transaction-level
          dashboard — this doesn't replicate that.
        </p>
        <ul>
          <li>
            <strong>Profile editor</strong> at the top: monthly income, monthly fixed expenses,
            optional notes. Update when reality shifts (quarterly is fine).
          </li>
          <li>
            <strong>Discretionary</strong> = income − fixed. That's the budget the system uses
            for affordability decisions.
          </li>
          <li>
            <strong>Outsourceable routines table:</strong> every routine flagged{' '}
            <Cmd>outsourceable</Cmd>, with per-occurrence cost, computed monthly cadence, and
            monthly cost. A ✓ means it fits within your discretionary if you started with the
            most expensive item first.
          </li>
          <li>
            <strong>Persona chat:</strong> ask "what could I outsource for under $200/month?",
            "is a biweekly cleaner viable?", "is the Airbnb pre-clean worth outsourcing if I
            host once a month?". The persona has tools to query both your profile and the
            outsourceable list.
          </li>
        </ul>
        <p>
          Defaults are seeded from the inventory based on typical local-market rates; edit any
          per-routine cost via the persona chat ("set yard pickup to $40 per visit") or via the
          API. RocketMoney CSV import is on the future-iterations list per HANDOFF.md §17 if
          you ever want categorized transaction history inside the system.
        </p>
      </Section>

      <Section title="Routines tab">
        <p>
          Edit the cadences, energy estimates, time estimates, and active state of any routine.
          Useful when:
        </p>
        <ul>
          <li>A weekly task feels like it should be biweekly (bump <Cmd>interval_days</Cmd>).</li>
          <li>An estimate is consistently wrong (adjust <Cmd>estimate_minutes</Cmd>).</li>
          <li>You want to retire a routine without deleting it (set <Cmd>active: false</Cmd>).</li>
        </ul>
        <p>
          Edits are immediate. The next morning's plan generation reflects them.
        </p>
      </Section>

      <Section title="Check-ins (the banner)">
        <p>
          The check-in banner appears at the top of the Today tab when something's pending. Up to
          one banner at a time, in priority order:
        </p>
        <ol>
          <li>
            <strong>Pattern interrupts</strong> — fired when data warrants it. Example: yard
            pickup deferred 3+ times in 14 days. Asks: push through / swap something / adjust
            cadence / skip on purpose.
          </li>
          <li>
            <strong>Morning intent</strong> (~7am) — what's the one thing today, energy, mood.
            Mood and energy get logged automatically as side effects.
          </li>
          <li>
            <strong>Zone assessment</strong> (~12pm) — rotates through your 6 zones one per day.
            "How is the kitchen looking? Fine / Meh / Rough." If meh or rough, you can add a
            specific note ("counters need wiping") and the system creates a one-off task that
            shows up in the next morning's plan.
          </li>
          <li>
            <strong>Evening retro</strong> (~9pm Mon–Sat) — what got skipped, anything to adjust.
          </li>
          <li>
            <strong>Weekly review</strong> (~9pm Sunday, replaces evening retro that day) —
            shows your last-7-days stats and asks if anything needs adjustment.
          </li>
        </ol>
        <p>
          Every check-in has a <em>skip</em> button. Skipping logs that you skipped (so the
          system can spot patterns of skipped retros, etc). Pending check-ins expire after 24h.
        </p>
      </Section>

      <Section title="Alexa voice commands">
        <p>
          Hands-free for everything you'd otherwise click. Start any of these with{' '}
          <Cmd>Alexa, ask Home Ops</Cmd> (single turn) or <Cmd>Alexa, open Home Ops</Cmd> (then
          continue speaking, multi-turn).
        </p>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={headerCellStyle}>Say</th>
              <th style={headerCellStyle}>Effect</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={cellStyle}><Cmd>what's on today</Cmd></td>
              <td style={cellStyle}>Speaks today's pending items</td>
            </tr>
            <tr>
              <td style={cellStyle}><Cmd>mark trash done</Cmd> / <Cmd>I finished the litter</Cmd></td>
              <td style={cellStyle}>Marks a task done by fuzzy name match</td>
            </tr>
            <tr>
              <td style={cellStyle}><Cmd>defer yard pickup</Cmd> / <Cmd>swap kitchen reset</Cmd></td>
              <td style={cellStyle}>Moves an item to swap pool</td>
            </tr>
            <tr>
              <td style={cellStyle}><Cmd>pull mop back into today</Cmd></td>
              <td style={cellStyle}>Pulls a deferred item back to active</td>
            </tr>
            <tr>
              <td style={cellStyle}><Cmd>I'm low energy</Cmd> / <Cmd>energy is high</Cmd></td>
              <td style={cellStyle}>Logs energy + speaks any swap suggestions</td>
            </tr>
            <tr>
              <td style={cellStyle}><Cmd>I'm feeling good</Cmd> / <Cmd>my mood is down</Cmd></td>
              <td style={cellStyle}>Logs mood</td>
            </tr>
            <tr>
              <td style={cellStyle}><Cmd>what's today's workout</Cmd></td>
              <td style={cellStyle}>Speaks today's slot + whether it's logged</td>
            </tr>
            <tr>
              <td style={cellStyle}><Cmd>I worked out</Cmd> / <Cmd>I skipped my workout</Cmd></td>
              <td style={cellStyle}>Logs workout status (done / partial / skipped)</td>
            </tr>
            <tr>
              <td style={cellStyle}><Cmd>the kitchen is rough</Cmd> / <Cmd>bathrooms are meh</Cmd></td>
              <td style={cellStyle}>Logs a zone assessment + auto-creates a task if not "fine"</td>
            </tr>
            <tr>
              <td style={cellStyle}><Cmd>any check-ins pending</Cmd></td>
              <td style={cellStyle}>Lists queued prompts</td>
            </tr>
            <tr>
              <td style={cellStyle}><Cmd>answer my morning check-in</Cmd></td>
              <td style={cellStyle}>Multi-turn dialog: one thing → energy → mood</td>
            </tr>
            <tr>
              <td style={cellStyle}><Cmd>what did I do today</Cmd></td>
              <td style={cellStyle}>Reads recent activity summary</td>
            </tr>
            <tr>
              <td style={cellStyle}><Cmd>any patterns</Cmd></td>
              <td style={cellStyle}>Frequent deferrals + workout summary</td>
            </tr>
            <tr>
              <td style={cellStyle}><Cmd>tell household ops [anything]</Cmd></td>
              <td style={cellStyle}>Free-form via the persona chat (slower; full Claude tool loop)</td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          Fuzzy name matching is permissive — partial words usually work. If Alexa can't find the
          item ("I don't see X on today"), say more or fewer words.
        </p>
      </Section>

      <Section title="How the daily plan gets built">
        <p>
          A new plan is generated automatically at <strong>6 AM local time</strong>. The pipeline:
        </p>
        <ol>
          <li>
            <strong>Day classification.</strong> Reads your Google Calendar for today (if creds
            are configured). Catering events → catering_day. Tue/Thu morning + PT keyword →
            tue_thu_pt. Weekend with no events → day_off. Otherwise → weekday_default.
          </li>
          <li>
            <strong>Time budget</strong> from the day type: 25min on PT days, 45min on regular
            weekdays, 60min on catering days, 150min on day-off.
          </li>
          <li>
            <strong>Candidate gathering:</strong>
            <ul>
              <li>Rolling routines that are due (last_done + interval_days &le; today, accounting for flex_days).</li>
              <li>Fixed routines for today's day-of-week (with biweekly check).</li>
              <li>Zone rotation task (computed from weeks-since-cleaner-visit, weekends only).</li>
              <li>Event-driven triggers (Airbnb checkin/checkout, dogsit arrival/departure, landscaper).</li>
              <li>Open ad-hoc tasks from zone assessments — priority bumps with severity and age.</li>
            </ul>
          </li>
          <li>
            <strong>skip_if + also_triggers.</strong> <Cmd>skip_if: landscaper_this_week</Cmd> on
            yard pickup means it's dropped if a landscaper is scheduled in the next 7 days.{' '}
            <Cmd>also_triggers</Cmd> on event-driven routines fans out related work (Airbnb pre-clean
            pulls in yard pickup unless the landscaper rule kicks in).
          </li>
          <li>
            <strong>Sort + pack.</strong> Highest priority first (most negative number). Pack into
            today's items until the budget is full; everything else goes into the swap pool. Each
            overflow logs a DeferralEvent with reason <Cmd>over_budget</Cmd>.
          </li>
        </ol>
        <p>
          You can force a regenerate with <strong>POST /api/today/regenerate</strong> — useful if
          you edit a routine and want today to reflect it.
        </p>
      </Section>

      <Section title="Patterns + accountability">
        <p>
          The system collects data passively. Pattern detection runs once per morning right after
          plan generation and creates pattern-interrupt check-ins for things worth pushing back on:
        </p>
        <ul>
          <li>
            <strong>Frequent deferrals:</strong> any routine deferred 3+ times in 14 days
            triggers an interrupt asking what you want to do about it.
          </li>
          <li>
            <strong>Missed workout streak:</strong> 2+ skipped workouts in 7 days triggers an
            interrupt on the next workout day.
          </li>
        </ul>
        <p>
          The persona chat ("any patterns") and the API endpoints under{' '}
          <Cmd>/api/patterns/*</Cmd> expose the same data on demand.
        </p>
      </Section>

      <Section title="Background automation summary">
        <p>Cron jobs that fire automatically (assumes the API is running):</p>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={headerCellStyle}>When</th>
              <th style={headerCellStyle}>What</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={cellStyle}>5:30 AM</td>
              <td style={cellStyle}>Pull next 7 days of Google Calendar events into Triggers</td>
            </tr>
            <tr>
              <td style={cellStyle}>6:00 AM</td>
              <td style={cellStyle}>Generate today's plan + run pattern detection</td>
            </tr>
            <tr>
              <td style={cellStyle}>7:00 AM</td>
              <td style={cellStyle}>Create morning intent check-in</td>
            </tr>
            <tr>
              <td style={cellStyle}>12:00 PM</td>
              <td style={cellStyle}>Create zone assessment check-in (rotates through 6 zones)</td>
            </tr>
            <tr>
              <td style={cellStyle}>9:00 PM Mon–Sat</td>
              <td style={cellStyle}>Create evening retro check-in</td>
            </tr>
            <tr>
              <td style={cellStyle}>9:00 PM Sun</td>
              <td style={cellStyle}>Create weekly review check-in (replaces evening retro)</td>
            </tr>
          </tbody>
        </table>
        <p>
          Plus debounced syncs to Google Calendar + Alexa app cards whenever today's plan
          mutates. Time-sensitive check-ins (morning intent, pattern interrupts) push proactive
          cards to the Alexa app if LWA credentials are configured.
        </p>
      </Section>

      <Section title="Privacy + data">
        <p>
          Everything lives in your MongoDB instance. The API doesn't share data with anyone.
          Specific external touchpoints:
        </p>
        <ul>
          <li>
            <strong>Anthropic API</strong> — only used during persona chat. Each turn sends the
            current conversation messages plus the persona's system prompt and tool definitions
            (with prompt caching enabled). Nothing else is sent.
          </li>
          <li>
            <strong>Google Calendar</strong> — read-only access to the calendar you configure (for
            day classification and trigger ingestion) and write access for one all-day event per
            day if you've enabled Calendar publishing.
          </li>
          <li>
            <strong>Alexa</strong> — voice input is processed by Amazon's standard Alexa pipeline.
            The skill itself only receives intent names + slot values from Alexa, never raw audio.
          </li>
        </ul>
      </Section>

      <Section title="Troubleshooting">
        <ul>
          <li>
            <strong>Today's plan looks empty.</strong> Either no routines are due (legit) or the
            DB seeding didn't reach the right database. Hit <Cmd>/api/routines</Cmd> directly —
            should return 18 entries from the inventory.
          </li>
          <li>
            <strong>Alexa says "there was a problem with the requested skill's response".</strong>{' '}
            Check the API logs in Render — usually a thrown error in a handler. Often a missing
            env var (Anthropic key, Mongo URL) on the deployed instance.
          </li>
          <li>
            <strong>Echo says "I don't know that one" / not supported on this device.</strong>{' '}
            Almost always an account mismatch. The Echo's Amazon account must match the
            developer console account.
          </li>
          <li>
            <strong>Check-in banner stuck.</strong> Pending check-ins past 24h auto-expire on the
            next page load. If a particular one is wedged, hit{' '}
            <Cmd>POST /api/checkins/[id]/skip</Cmd> to clear it.
          </li>
          <li>
            <strong>Pattern interrupts firing too often.</strong> Adjust thresholds in{' '}
            <Cmd>services/checkin-generators.ts</Cmd> — currently 3 deferrals in 14 days for
            routines, 2 skipped workouts in 7 days for fitness.
          </li>
        </ul>
      </Section>
    </div>
  );
}
