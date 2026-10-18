# context.md — for Ali's Claude

Read this together with `CLAUDE.md` (the shared contract). `CLAUDE.md` says **what** everyone builds. This file says **what already exists, what's being reused, and what state the repo is in**, so you don't rebuild or assume anything.

You are working for **Ali**. Your scope is the lead engine (F3), Telegram alerts (I4), Google Calendar (I3) and the leads, recovery, rules and profile UI. The full list is in `CLAUDE.md` §13 under ALI. Touch only the files §6 assigns to Ali.

---

## 1. Current state of the repo (as of 13:00)
- Repo: `github.com/MuhammadAli128106/Buisness-Management-Platform`. It's **empty right now**. Musa's Claude is building the foundation.
- **Push #1 (about T+0:35)** brings:
  - auth, workspaces, roles and permissions, and the audit/activity/mask/crypto/retry helpers
  - the integration store and event recorder, the UI kit and the app shell
  - the seed script
  - **stub files for every file you own**, with the exact §9 signatures. Server stubs return 501, and page stubs render "Coming soon".
- **Push #2 (about T+1:00)** brings the CRM backend: contacts, companies, opportunities, pipelines, stages, custom fields, notes and activities.
- **Until push #1 lands:** write `server/services/leadEngine.js`, `leadTicker.js` and `notify.js` locally against the schema in `CLAUDE.md` §7 and the helper signatures in §3 below. When push #1 lands, `git pull --rebase` and overwrite the stubs with your files. You don't need a running app to write the engine.
- **Don't create** `server/index.js`, `package.json`, `schema.sql`, `App.jsx` or `Sidebar.jsx`. Musa's files mount and register your routes and pages already, so you never need to edit them.

## 2. Where the reused code comes from
Musa has two production apps built on the same stack. You don't have access to them, but your code will run on top of what's copied out of them.
- **RSFM** (dairy farm manager): the main source. From it we copy:
  - hardened auth: httpOnly session cookie (15 min), a rotating refresh cookie (7 days, hashed in the DB), CSRF double-submit (`x-csrf-token` header from a cookie), `express-rate-limit` on login, helmet, bcrypt
  - the pg helpers, the activity logger (which becomes our `audit()`) and the CSV export
  - the client: the `apiFetch` wrapper (handles CSRF and refresh), AuthContext, Layout, Sidebar, TopBar, PageHeader and StatCard, plus the Tailwind config (navy/blue palette, Inter font)
- **Dhanak** (banquet hall manager): we only borrow `BookingCalendarWidget.jsx`, which is a month calendar grid. Musa can paste it to you if you want it as the base for the date picker in `BookAppointmentModal`. It's optional.
- **Deliberately NOT copied:**
  - RSFM's auto-logout-on-close (it breaks "refresh keeps you logged in")
  - RSFM's role-name permission checks such as `role === 'admin'`. We check permission keys only.
  - Never write `if (user.level === 'admin')` for authorisation. Use `requirePerm('leads.reassign')` on the server and `can('leads.reassign')` on the client.

## 3. Helpers you can rely on (exact shapes)
**`server/db/index.js`** (copied from RSFM; `pg.Pool`, int8 and numeric parsed to JS numbers):
```js
const { pool, queryOne, queryAll, queryRun, queryInsert, withTransaction } = require('../db/index');
await queryOne(sql, params)     // → first row | undefined
await queryAll(sql, params)     // → rows[]
await queryRun(sql, params)     // → raw pg result (use .rowCount)
await queryInsert(sql, params)  // → first row (use with RETURNING *)
await withTransaction(async (client) => { await client.query(sql, params); ... })  // BEGIN/COMMIT/ROLLBACK, returns cb result
```
Always use `$1, $2` params. Inside a transaction, use `client.query(...)` and **not** the helpers. The helpers use the pool, which means a different connection outside your transaction.

**`server/middleware/auth.js`:**
```js
const { requireAuth, requirePerm, hasPerm } = require('../middleware/auth');
// requireAuth is already applied globally to /api/v1 (except public + webhooks). Don't add it again.
// req.user = { id, ws, name, email, level, role_id, status, permissions: [...] }  (loaded from DB each request)
router.post('/:id/reassign', requirePerm('leads.reassign'), handler);
if (!hasPerm(req, 'leads.view_all')) { /* scope to own leads */ }
```
`level === 'owner'` passes every `requirePerm` automatically.

**`server/middleware/validate.js`** (zod):
```js
const { z } = require('zod');
const { validate } = require('../middleware/validate');
router.put('/', requirePerm('rules.manage'), validate({ body: z.object({ ack_window_seconds: z.number().int().min(5).max(86400) }) }), handler);
// on failure → 400 { error: 'Invalid input', details: { field: 'msg' } }
```

**Other utilities:**
```js
const { audit } = require('../utils/audit');           // audit(reqOrNull, { ws, event_type, target_type, target_id, before, after }, client?)  — null req = "System"
const { logActivity } = require('../utils/activity');  // logActivity({ ws, contact_id, opportunity_id, lead_id, type, actor_id, summary, data }, client?)
const { encrypt, decrypt } = require('../utils/crypto');            // AES-256-GCM with APP_ENC_KEY; use for Google tokens
const { withRetry } = require('../utils/retry');                    // withRetry(fn, { attempts: 3, baseMs: 500, isTemporary })
const { getConfig, markOk, markError } = require('../services/integrationsStore'); // getConfig(ws,'telegram') → { bot_token } | null
const { recordEvent } = require('../services/integrationEvents');  // call on EVERY Telegram/Google request (I5.4)
```
**Route style:** each route file exports an `express.Router()`. Musa mounts them as follows:
- `routes/leads.js` at `/api/v1/leads`
- `routes/publicForms.js` at `/api/v1/public/forms`, before auth and before CSRF
- `routes/availability.js`, `routes/telegram.js` and `routes/assignmentRules.js` at `/api/v1`, so you define full sub-paths like `/me/status`, `/users/:id/status`, `/me/telegram`, `/notifications` and `/assignment-rules`
- `routes/calendar.js` at `/api/v1`, defining `/integrations/google/*` and `/calendar/busy`. The Google callback is excluded from `requireAuth` by Musa and is verified by your signed `state`.
- `routes/appointments.js` at `/api/v1/appointments`

`leadTicker.start()` is called once by Musa in `index.js` after `initDb()`. Export `start` and `stop`.

**Responses:** `res.json({ data })` or `res.json({ data, total, page, limit })`. Errors: `res.status(4xx).json({ error: 'human sentence' })`. Uncaught errors go to `errorHandler` (500 `{error:'Internal server error'}`), so wrap async handlers in try/catch or use `next(err)`.

**Client:**
```js
import useSWR from 'swr';
import { apiGet, apiPost, apiPatch, apiDelete } from '../utils/api';      // throw Error(serverText) with .status/.details
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';   // { user, loading, logout } — user has permissions[], workspace, timezone
import { useCan } from '../hooks/useCan';            // const can = useCan(); can('leads.reassign')
const { data, mutate } = useSWR('/leads?scope=mine', apiGet, { refreshInterval: 3000 });
```
The UI kit in `components/ui/` provides PageHeader, Button, Modal, Field, Input, Select, Textarea, Checkbox, DataTable (turns into cards on mobile), Pagination, Badge, StatCard, EmptyState, Spinner and ConfirmDialog. Props are in `CLAUDE.md` §13 under AHMED. Use these instead of writing new ones. Styling is Tailwind with `primary` `#2563eb` and the navy palette, and every input goes inside `<Field label>`.

## 4. Things other people's code calls on you (don't change these signatures)
- **Musa's Twilio webhook** calls `createLead({ ws, contactId, source: 'whatsapp', sourceDetail: '+92…', client })` **inside its own transaction** and passes `client`, so use `client` for every query when it's given.
- **Musa's `POST /notes`, outbound WhatsApp send and `POST /opportunities/:id/move`** call `recordAction({ ws, contactId, userId, kind })`. This must make a lead owned by `userId` that's still `assigned` become `acknowledged`, set `first_ack_at` if it's null, and always bump `last_action_at`.
- **Musa's contact delete** calls `closeLeadsForContact({ ws, contactId, client })`.
- **Musa's user deactivation** (`PATCH /users/:id {is_active:false}`) calls `onStatusChange({ ws, userId, status: 'offline', actorId })`.
- **Musa's Users settings page** calls your `PATCH /users/:id/status {status}` for the status dropdown, and shows `calendar_status` and `telegram_connected`. Musa computes those from `google_tokens` and `users.telegram_chat_id` in `GET /users`.
- **Musa's dashboard** (`services/metrics.js`) reads your tables directly to compute `new_leads_today`, `avg_first_response_seconds`, `recovery_count`, `escalations_24h` and `upcoming_appointments`.
  - It uses the **recovery definition in `CLAUDE.md` §10**. If you change that definition, tell Musa.
  - Better: export `recoveryWhereSql()` from `leadEngine.js` (a SQL fragment plus params), and Musa will reuse it so the numbers always match.
- **Ahmed's ContactDetail and OpportunityDetail pages** render your `<AppointmentsPanel contactId|opportunityId />` and `<BookAppointmentModal open onClose contactId opportunityId onBooked />`. Keep those props.
- **Musa's Layout** renders your `<LeadAlerts />`, and the TopBar renders `<AvailabilityToggle />`. Neither takes props.

## 5. Infra facts
- **One shared Railway Postgres** for dev and the demo. Musa sends `DATABASE_URL` (the public URL) for your `server/.env`. Other people's rows live in it too, so always scope by `workspace_id`.
- The schema is applied on every server boot. If you need an index, put it in `server/db/patches/ali.sql` (run after `schema.sql`, must be idempotent). For any **table or column** change, message Musa instead.
- **Dev:** `server` runs on 8080 (`npm run dev`), and `client` runs on 5173 and proxies `/api`. Production is one Railway service from `main`, with `PUBLIC_URL` = the Railway https domain.
- **Env you'll use:** `PUBLIC_URL` (for links in Telegram messages and the Google redirect URI), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `APP_ENC_KEY` (through `crypto.js`). Ahmed creates the Google OAuth client, with all 3 team Gmails as test users and redirect URI `PUBLIC_URL/api/v1/integrations/google/callback`.
- **Telegram:** Ahmed creates the bot and enters the token on the Integrations page. You read it with `getConfig(ws, 'telegram')`.
- `googleapis` and `zod` are already in `server/package.json`. Don't add packages yourself; ask Musa.
- **Seeded logins** (after push #1, all with password `Demo1234!`):
  - owner@acme.test (Owner)
  - ali@acme.test (Admin)
  - ahmed@acme.test and rep2@acme.test (Sales Reps, with backup and manager set)
  - owner@beta.test (a second workspace, for isolation tests)
  - The public form slug is `acme-solar` → `/f/acme-solar`.

## 6. Gotchas specific to your part
- **Timers:** never use `setTimeout` per lead. The deadlines live in `leads.ack_deadline`, and the 2 s ticker does all the work. This is what survives a Railway restart (Q5), and the judges will restart it.
- **Concurrency:** use `FOR UPDATE SKIP LOCKED` in the ticker, plus `UPDATE … WHERE id=$1 AND version=$2`, and check `rowCount === 1`. Assignment locks the workspace's `assignment_rules` row with `FOR UPDATE` so two simultaneous leads can't both take the last slot.
- **Compare times in SQL** (`now()`), not in JS, to avoid clock drift between Railway instances.
- **Countdowns on the client:** compute them from `seconds_left` (server-computed, `EXTRACT(EPOCH FROM ack_deadline - now())`) plus a local tick. Don't trust the browser clock against an absolute deadline.
- **`first_owner_id`** anchors the backup and manager in the chain. Set it only on the first assignment.
- Express 5 is in use: `req.query` is read-only, and async errors propagate to `errorHandler`.
- **CSRF:** non-GET calls must go through `apiPost`/`apiPatch`/`apiDelete`, which add the header. A raw `fetch` will get a 403.
- **Google:** use `prompt: 'consent'` or you won't get a refresh token on the second connect. On `invalid_grant`, set `needs_reconnect`; don't crash the request.
- **Telegram failures must never throw** out of the ticker loop. Wrap each notification on its own.
- **Audit and activity writes inside a transaction** must pass `client`, so they roll back with it.

## 7. Communication
- Need something that Musa or Ahmed owns? Message them; don't edit their file.
- Commit prefix `[ali]`. Run `git pull --rebase` before you push, and `cd client && npm run build` must pass before you push.
- Code freeze is at **T+3:15**. After that, bug fixes only.
