# Unified Business Management Platform

A multi-tenant CRM for service companies with 5 to 30 people. Each company gets its own **workspace**, fully isolated from every other.

**Core promise:** every incoming lead always has exactly one accountable owner, and it escalates automatically if nobody acts on it. Leads arrive from a public web form, WhatsApp, or manual entry.

## Features

- **Workspaces, roles and permissions:** server-side permission checks, masked opportunity values for roles without access, strict isolation between workspaces.
- **CRM:** contacts, companies, opportunities, custom pipelines and stages, custom fields (per pipeline), tags, saved filter lists, CSV export, activity timeline.
- **Lead engine:** automatic assignment, acknowledgement window, escalation, availability and leave handling, recovery queue. Timers survive a server restart.
- **WhatsApp (Twilio):** inbound and outbound messages, delivery status, duplicate and forged webhook protection, opt-out handling.
- **Payments (Stripe, test mode):** payment links, live status updates, refunds.
- **Calendar (Google):** book, reschedule and conflict-check appointments.
- **Alerts (Telegram):** escalation notifications.
- **Audit log:** append-only record of important events.
- **Live dashboard:** key numbers, pipeline by stage, availability, upcoming appointments, collected vs projected payments.

## Tech stack

| Layer | Tools |
|---|---|
| Server | Node 20, Express 5, `pg`, zod, bcryptjs, jsonwebtoken, helmet, express-rate-limit, `twilio`, `stripe`, `googleapis` |
| Client | React 19, Vite, Tailwind 3, react-router-dom 7, SWR, sonner, recharts |
| Database | PostgreSQL 13 or newer |
| Deploy | One Railway service built from `main` |

The server serves the API at `/api/v1` and the built client as a single-page app, all on one origin.

## Setup (local)

**Prerequisites:** Node 20+, Git, and a Postgres database. The team uses one shared Railway Postgres, so use its **public** URL.

1. **Clone**
   ```bash
   git clone https://github.com/MuhammadAli128106/Buisness-Management-Platform
   cd Buisness-Management-Platform
   ```
2. **Create `server/.env`** from the template, then fill in every value (see the table below):
   ```bash
   cp .env.example server/.env
   ```
3. **Install dependencies**
   ```bash
   cd server && npm install
   cd ../client && npm install
   cd ..
   ```
4. **Seed the database** (creates the demo workspaces and users):
   ```bash
   node server/db/seed.js
   ```
5. **Run both servers** in two terminals:
   ```bash
   cd server && npm run dev      # API on http://localhost:8080
   cd client && npm run dev      # app on http://localhost:5173
   ```
   Vite proxies `/api` to the server, so the app behaves as same-origin in development.

Open http://localhost:5173.

## Environment variables

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. |
| `JWT_SECRET` | Signs login tokens. Generate with `openssl rand -hex 32`. |
| `APP_ENC_KEY` | AES-256-GCM key for integration secrets and Google tokens. Generate with `openssl rand -hex 32`. |
| `PUBLIC_URL` | Public HTTPS address of the app, no trailing slash. Needed for webhooks and OAuth. |
| `NODE_ENV` | `production` on Railway. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth client. |
| `PORT` | Set by Railway. Defaults to 8080 locally. |

Twilio, Stripe and Telegram credentials are **per workspace**. Enter them on **Settings → Integrations**. They are stored encrypted and only ever shown masked.

## Demo logins

After seeding, all demo accounts use the password `Demo1234!`.

| Workspace | Email | Role |
|---|---|---|
| Acme Solar | `owner@acme.test` | Owner |
| Acme Solar | `ali@acme.test` | Admin |
| Acme Solar | `ahmed@acme.test` | User |
| Acme Solar | `rep2@acme.test` | User |
| Beta Realty | `owner@beta.test` | Owner (used for isolation tests) |

These are demo accounts for a seeded test database only. Never reuse these passwords anywhere real.

## Integration setup

Webhooks need a public HTTPS address. Test against the Railway URL, or locally run `cloudflared tunnel --url http://localhost:8080` and set `PUBLIC_URL` to the tunnel URL.

### Railway
1. New Project → Deploy from GitHub repo → add a PostgreSQL service.
2. Set the variables from the table above. `DATABASE_URL` is `${{Postgres.DATABASE_URL}}`.
3. Settings → Networking → Generate Domain, then paste it into `PUBLIC_URL`.
4. Build command `npm run build`, start command `npm start`.

### Twilio WhatsApp sandbox
1. Sign up → Messaging → Try it out → WhatsApp sandbox.
2. Every tester sends the join phrase from their own phone.
3. Copy the Account SID, Auth Token and sandbox number (`whatsapp:+14155238886`) into **Settings → Integrations**.
4. In the sandbox settings, set **When a message comes in** to
   `PUBLIC_URL/api/v1/webhooks/twilio/<workspaceId>` (POST). The workspace id is shown on the Integrations page.

*Limits:* the sandbox only reaches phones that sent the join phrase, and free-form replies only work within 24 hours of the customer's last message.

### Stripe (test mode)
1. Sign up and stay in **Test mode**. Copy the `sk_test_...` key from Developers → API keys.
2. Developers → Webhooks → Add endpoint:
   `PUBLIC_URL/api/v1/webhooks/stripe/<workspaceId>`
   with these events: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed`, `payment_intent.payment_failed`, `charge.refunded`.
3. Copy the signing secret (`whsec_...`).
4. Paste the secret key and the signing secret into **Settings → Integrations**.

*Test card:* `4242 4242 4242 4242`, any future date, any CVC.

### Google Calendar
1. Google Cloud: create a project and enable the **Google Calendar API**.
2. OAuth consent screen: External, Testing, and add every team member's Gmail as a test user.
3. Credentials → OAuth client ID (Web application). Authorized redirect URI:
   `PUBLIC_URL/api/v1/integrations/google/callback`
4. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the environment variables.

*Limits:* the app is in Google testing mode, so only listed test users can connect, and refresh tokens may expire after 7 days.

### Telegram
1. Message @BotFather → `/newbot` → copy the bot token into **Settings → Integrations**.
2. Each employee sends `/start` to the bot, gets their chat id from @userinfobot, and enters it on their Profile page.

## Tests

Workspace isolation and permission checks:

```bash
bash server/scripts/isolation-test.sh
```

Expected: every cross-workspace request returns 404, and unauthorized deletes return 403.

## Team workflow

- Everyone commits to `main` and edits only the files they own.
- `git pull --rebase` before every push.
- Before pushing: `cd client && npm run build` must pass and `node server/index.js` must boot.
- Never commit `.env`, keys or tokens. Never force-push.
