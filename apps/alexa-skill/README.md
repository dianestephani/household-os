# Alexa skill — Household Ops

Custom Alexa skill that wraps the API. Voice for **actions**, the Alexa app for **awareness** (proactive push when time-sensitive check-ins arrive).

## Architecture

The skill is mounted on the existing API server as an Express webhook at `POST /alexa`. There's no separate skill server to deploy — start the API, expose it via HTTPS, and Alexa hits it directly.

```
Echo device  ──▶  Alexa Voice Service  ──▶  https://your-host/alexa
                                                      │
                                                      ▼
                                                Express API
                                                      │
                                                      ▼
                                                  MongoDB
```

The skill code lives here ([src/skill.ts](src/skill.ts), [src/handlers/](src/handlers/)) but at runtime it's imported by [`apps/api/src/index.ts`](../api/src/index.ts) which mounts it via `ask-sdk-express-adapter`.

## What you can say

| Voice | Effect |
|---|---|
| "what's on today" | Speaks today's pending items |
| "mark trash done" / "I finished litter" | Marks task done by fuzzy name match |
| "defer yard pickup, I'm tired" | Defers task with reason |
| "pull mop back into today" | Pulls from swap pool |
| "I'm low energy" / "energy is high" | Logs energy + speaks suggestions |
| "I'm feeling good" / "my mood is down" | Logs mood |
| "what's today's workout" | Speaks today's PT/lift slot |
| "I worked out" / "I skipped my workout" | Logs workout status |
| "the kitchen is rough" / "bathrooms are meh, sink + toilet" | Logs zone assessment, auto-creates task |
| "any check-ins pending" | Lists queued prompts |
| "answer my morning check-in" | Multi-turn: asks one_thing → energy → mood, submits |
| "what did I do today" | Reads recent activity summary |
| "any patterns" | Frequent deferrals + workout summary |
| "tell household ops [anything]" | Free-form via persona chat (slower, full Claude tool loop) |

## One-time setup (Diane-side)

You need: an Amazon Developer account (free), a publicly reachable HTTPS endpoint, and a way to test before going live.

### 1. Amazon Developer console — create the skill shell

1. Go to [developer.amazon.com/alexa/console/ask](https://developer.amazon.com/alexa/console/ask) and sign in.
2. **Create Skill** → name "Household Ops" → custom model → host elsewhere.
3. Once created, on the left sidebar:
   - **Invocation** → set name to `home ops`
   - **Interaction Model → JSON Editor** → paste the contents of [interaction-model.en-US.json](interaction-model.en-US.json) → Save → Build Model
   - **Endpoint** → HTTPS → enter `https://YOUR-HOST/alexa` → SSL cert: "My development endpoint is a sub-domain of a domain that has a wildcard certificate from a certificate authority" (works for ngrok)
   - **Permissions** → enable **Notifications** (for proactive events)
4. Save. Copy the **Skill ID** (looks like `amzn1.ask.skill.XXXX`) — you'll need it for `.env`.

### 2. Local dev — ngrok tunnel

ngrok gives you a temporary HTTPS URL that forwards to localhost.

```bash
brew install ngrok                            # one-time
ngrok config add-authtoken <YOUR_AUTHTOKEN>   # one-time — paste the real token from your ngrok dashboard
ngrok http 3000                               # run while the API is up
```

> Don't paste the literal `<YOUR_AUTHTOKEN>` placeholder. Replace it with the long string from
> [your ngrok dashboard](https://dashboard.ngrok.com/get-started/your-authtoken) (free account if you don't have one).

Copy the `https://...ngrok-free.app` URL. Paste it into the skill's Endpoint field as `https://...ngrok-free.app/alexa`. Save and rebuild the model.

Now go to **Test** in the Amazon console, enable testing in Development, and type `open home ops`. The simulator hits your local API.

### 3. `.env` settings

Add to the project's `.env`:

```
ALEXA_SKILL_ID=amzn1.ask.skill.YOUR-SKILL-ID
# Optional — for proactive push to the Alexa app:
ALEXA_CLIENT_ID=amzn1.application-oa2-client.YOUR-CLIENT-ID
ALEXA_CLIENT_SECRET=YOUR-SECRET
# Dev-only: skips Alexa request signature verification (use ngrok in dev instead — leave this off)
# ALEXA_SKIP_VERIFY=1
```

The LWA client id/secret comes from the Amazon Developer console under **Permissions → Send Alexa Events**. You only need them if you want proactive push (the time-sensitive app cards).

If your API requires `API_TOKEN`, also set `HOUSEHOLD_API_TOKEN` to the same value — the skill uses it as a bearer token.

### 4. Voice testing

In the Alexa app on your phone, the skill should now appear in **Skills & Games → Your Skills → Dev**. Enable it. Then:

- Say "Alexa, open home ops" to start a conversation, or
- Say "Alexa, ask home ops what's on today" for a single turn.

## Lambda alternative

If you'd rather deploy to AWS Lambda instead of running the Express webhook publicly:

1. Build: `npm -w @household-os/alexa-skill run build` (compiles to `dist/`)
2. Bundle: zip `dist/` plus a top-level entrypoint that re-exports the Lambda handler from `dist/skill.js`
3. Deploy: upload the zip to a new Lambda (Node 20 runtime), set the handler to `index.handler`
4. Permissions: give the Lambda env vars for the API base URL + token, and add the Alexa Skills Kit trigger
5. In the skill's Endpoint, switch from HTTPS to AWS Lambda ARN

This adds AWS account + IAM + deploy plumbing in exchange for one fewer thing to keep publicly reachable. For a single-user setup, the Express webhook is simpler.

## Proactive push

When configured (via `ALEXA_CLIENT_ID` + `ALEXA_CLIENT_SECRET`), these events fire app cards:

- **Morning intent** check-in created (~7 AM) → "Morning check-in pending"
- **Pattern interrupt** check-in created → "Yard pickup deferred 4 times. Decide?"

Evening retros, weekly reviews, and zone-assessment check-ins do **not** push — they live in the dashboard. This intentionally limits the noise; pattern interrupts and morning check-ins are the prompts you actually need at-a-glance.

## Troubleshooting

- **"There was a problem with the requested skill's response"** — usually a thrown error in a handler. `npm run dev:api` shows the stack trace. Often a missing slot value.
- **Signature verification fails on first deploy** — make sure `/alexa` is mounted **before** `express.json()` (the adapter needs the raw body to verify Amazon's signature). The current API setup does this correctly.
- **Proactive event 401** — `ALEXA_CLIENT_ID`/`SECRET` are wrong, or the LWA scope isn't `alexa::proactive_events`.
- **Skill responds in console but not on device** — make sure the skill is enabled in your Alexa app, and your account is the same Amazon account as the developer console.
