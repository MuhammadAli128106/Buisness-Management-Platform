<div align="center">

# 💼 Unified Business Management Platform

### No lead left behind.

![React](https://img.shields.io/badge/React_19-20232A?style=flat&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-0F172A?style=flat&logo=tailwindcss&logoColor=38BDF8)
![Node.js](https://img.shields.io/badge/Node_20-339933?style=flat&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express_5-000000?style=flat&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram_Bot-26A5E4?style=flat&logo=telegram&logoColor=white)
![Google Pay](https://img.shields.io/badge/Google_Pay_(test)-4285F4?style=flat&logo=googlepay&logoColor=white)

</div>

---


A multi-tenant CRM for service companies with 5 to 30 people. Each company gets its own **workspace**, fully isolated from every other.

**Core promise:** every incoming lead always has exactly one accountable owner, and it escalates automatically if nobody acts on it. Leads arrive from a public web form, Telegram, or manual entry.

## Features

- **Workspaces, roles and permissions:** server-side permission checks, masked opportunity values for roles without access, strict isolation between workspaces.
- **CRM:** contacts, companies, opportunities, custom pipelines and stages, custom fields (per pipeline), tags, saved filter lists, CSV export, activity timeline.
- **Lead engine:** automatic assignment, acknowledgement window, escalation, availability and leave handling, recovery queue. Timers survive a server restart.
- **Messaging (Telegram):** inbound and outbound customer messages, delivery status, duplicate and forged webhook protection, opt-out handling.
- **Payments (Google Pay, test mode):** payment links sent over Telegram, live payment status, and in-app refund records. No real money is charged.
- **Calendar (Google):** book, reschedule and conflict-check appointments.
- **Alerts (Telegram):** escalation notifications to employees.
- **Audit log:** append-only record of important events.
- **Live dashboard:** key numbers, pipeline by stage, availability, upcoming appointments, collected vs projected payments.

## Tech stack

| Layer | Tools |
|---|---|
| Server | Node 20, Express 5, `pg`, zod, bcryptjs, jsonwebtoken, helmet, express-rate-limit, `googleapis` |
| Client | React 19, Vite, Tailwind 3, react-router-dom 7, SWR, sonner, recharts |
| Database | PostgreSQL 13 or newer |
| Deploy | Railway (single service built from `main`) or Vercel (`vercel.json`, serverless API in `api/index.js`) |

The server serves the API at `/api/v1` and the built client as a single-page app, all on one origin.

## Setup (local)

**Prerequisites:** Node 20+, Git, and a Postgres database. The team uses one shared Railway Postgres, so use its **public** URL.

1. **Clone**
   ```bash
   git clone https://github.com/MuhammadAli128106/Business-Management-Platform
   cd Business-Management-Platform
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
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth client (Google Calendar). |
| `PORT` | Set by Railway. Defaults to 8080 locally. |

Telegram and Google Pay credentials are **per workspace**. Enter them on **Settings → Integrations**. They are stored encrypted and only ever shown masked.

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

### Telegram (customer messaging and employee alerts)
1. Message @BotFather → `/newbot` → copy the bot token.
2. Paste the token into **Settings → Integrations** and save. The app checks the token and registers the webhook automatically
   (`PUBLIC_URL/api/v1/webhooks/telegram/<workspaceId>`, protected by a secret-token header). Make sure `PUBLIC_URL` is set first.
3. **Employees (alerts):** each employee sends `/myid` to the bot, then enters the chat id on their Profile page. Employee chats never become leads.
4. **Customers (messaging):** a customer messages the bot, which creates a contact and a lead (source `telegram`). `/stop` opts them out and `/start` opts them back in.

*Limits:* a bot cannot message someone who has never messaged it, so "Message" on a contact fails with a clear reason until they do. One bot token serves one workspace.

### Google Pay (test mode)
1. In **Settings → Integrations → Payments**, enter the **merchant name** shown in the Google Pay sheet. Leave verification on `strict`.
2. On an opportunity, create a payment request and send it. The customer receives a link (`PUBLIC_URL/pay/<token>`, valid 30 minutes) over Telegram and pays with the real Google Pay sheet in the TEST environment.
3. The server verifies the payment token against Google's published TEST signing keys before marking the payment paid. Card details never reach our servers.

*Limits:* TEST environment only, so no real money moves, and any card saved in the payer's Google account returns a test token. Google Pay has no refund API in TEST mode, so refunds are recorded in the app by an authorised user.

### Google Calendar
1. Google Cloud: create a project and enable the **Google Calendar API**.
2. OAuth consent screen: External, Testing, and add every team member's Gmail as a test user.
3. Credentials → OAuth client ID (Web application). Authorized redirect URI:
   `PUBLIC_URL/api/v1/integrations/google/callback`
4. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the environment variables.

*Limits:* the app is in Google testing mode, so only listed test users can connect, and refresh tokens may expire after 7 days.

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

## Team

Built in a 4-hour hackathon by a team of three:

| Who | Built |
|---|---|
| **Musa** | Foundation (auth, workspaces, permissions, audit, CRM backend), Telegram messaging, Google Pay, integrations, dashboard backend |
| **[Syed Muhammad Ali](https://github.com/MuhammadAli128106)** | Lead engine (assignment, acknowledgement, escalation, absence, recovery), Telegram alerts, Google Calendar, leads and profile UI |
| **Muhammad Ahmed** | Provider setup, CRM pages, dashboard UI, contact and opportunity detail pages, responsive and accessibility pass, QA |
