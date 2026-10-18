# CLAUDE.md — Unified Business Management Platform (hackathon, 4 hours, 3 people)

> **Every Claude reading this: do Step 0 first, then read ONLY the shared sections + your own section.**
> Nothing in this project is "somebody else's problem, so I'll quickly do it too". If a task is not in YOUR list, you do not build it — you call the contract function / endpoint the owner will deliver, exactly as written here. If you think something is missing from everyone's list, STOP and tell your human to ask Musa; Musa edits this file.

## Step 0 — who am I working for?
Run `git config user.name` (and look at the human's messages). The team:

| Person | Tooling | Role in one line |
|---|---|---|
| **Musa** | Claude Pro (Claude Code) | Foundation (auth, workspaces, permissions, audit, CRM backend), Twilio, Stripe, integrations page, dashboard backend, seed, isolation test |
| **Ali** | Claude Pro (Claude Code) | Lead engine F3 (assignment, ack, escalation, absence, recovery), Telegram alerts, Google Calendar, leads/profile UI |
| **Muhammad Ahmed** | Free Claude / ChatGPT (chat only) | Provider account setup, all CRM pages, dashboard UI, contact/opportunity detail pages, responsive/a11y pass, README, QA |

If you can't tell who you're working for, ask: "Are you Musa, Ali or Ahmed?" and then follow only that section.

---

## 1. What we're building (the problem in 6 lines)
A multi-tenant CRM for 5–30 person service companies. Each company = one **workspace**, fully isolated.
Core promise: **every incoming lead always has exactly one accountable owner** and escalates automatically if ignored (web form, WhatsApp, manual entry).
Plus: customizable pipeline/fields, real WhatsApp (Twilio sandbox), real payments (Stripe test), real calendar (Google OAuth), escalation alerts via Telegram, append-only audit log, live dashboard.
Judges will test: workspace isolation via guessed IDs, server-side permission checks, double webhooks, two timers firing together, server restart mid-countdown, forged webhooks. Those are **never cut**.

## 2. Stack & runtime (decided — don't change)
- **Server**: Node 20, Express 5 (CommonJS), `pg`, bcryptjs, jsonwebtoken, cookie-parser, helmet, express-rate-limit, **zod** (validation), `twilio`, `stripe`, `googleapis`. Telegram via plain `fetch` (no lib).
- **Client**: React 19 + Vite + Tailwind 3, react-router-dom 7, **swr**, **sonner** (toasts), recharts.
- **DB**: one Railway Postgres (pg ≥ 13, `gen_random_uuid()` built in). Shared by all devs during the hackathon (put its *public* URL in your local `server/.env`). Reseeded at the end.
- **Deploy**: ONE Railway service from `main`. Root `npm run build` builds the client; `npm start` runs `server/index.js`, which serves the API at `/api/v1` and `client/dist` as an SPA. Same origin → cookies just work, no CORS.
- **Dev**: `cd server && npm run dev` (port 8080) + `cd client && npm run dev` (5173). Vite proxies `/api` → `http://localhost:8080`, so dev is also same-origin.
- **Webhooks** (Twilio/Stripe) need public HTTPS: test them against the Railway URL, or locally with `cloudflared tunnel --url http://localhost:8080` and set `PUBLIC_URL` to the tunnel URL.
- **Real-time (Q11)**: SWR polling. Intervals: leads/recovery/inbox/conversation 3000 ms, dashboard 10000 ms. No websockets.
- **Only Musa edits `package.json` files** (all deps above are pre-installed in push #1). Need a new dep? Ask Musa.

## 3. Timeline (T+0 = start; write clock times here: T+0 = ____ )
| Time | Musa | Ali | Ahmed |
|---|---|---|---|
| 0:00–0:35 | Scaffold **push #1** (everything in §6 marked "stub" exists; auth+perms+audit work; UI kit; seed) | Write `leadEngine.js`, `leadTicker.js`, `notify.js` against §7/§9 (no running app needed yet) | Accounts & Railway (§13.A) |
| 0:35–1:00 | **Push #2**: CRM backend (§8 CRM endpoints) | Wire engine, `routes/leads.js`, `routes/publicForms.js`, `routes/availability.js` | First deploy live; sign up demo workspace; register webhooks; paste creds on Integrations page |
| 1:00–2:15 | Twilio I1 → Stripe I2 | Leads UI, Recovery, Rules, Profile, LeadAlerts, then Telegram I4 | Contacts, Companies, Opportunities, PipelineBoard, Settings/Pipelines, Settings/CustomFields |
| 2:15–3:15 | Integrations page + events log, dashboard + metrics, `/contacts/:id/full`, Audit page, isolation test, final seed | Google Calendar I3 + AppointmentsPanel + BookAppointmentModal | Dashboard UI, ContactDetail, OpportunityDetail, ActivityTimeline, responsive/a11y pass |
| **3:15** | **CODE FREEZE — bug fixes only, no features** | | |
| 3:15–3:40 | fix bugs | fix bugs | run §15 checklist on deployed URL (phone + laptop), report bugs to file owner; README + `.env.example` |
| 3:40–4:00 | reseed, rehearse demo once, record backup screen video | | |

If at T+2:15 someone is behind, apply §14 cut line — don't silently drop things.

## 4. Git rules
- Everyone commits directly to `main`. **Only edit files you own (§6).** `git pull --rebase` before every push. Push at least every 30 min.
- Commit message prefix: `[musa]`, `[ali]`, `[ahmed]`.
- Before every push: `cd client && npm run build` must pass, and `node server/index.js` must boot. Railway deploys `main` — a broken push kills the demo for all three.
- Never commit `.env`, keys, tokens. Never `git push --force`. Conflict in a file you don't own → keep theirs (`git checkout --theirs <file>`) and tell them.

## 5. Environment variables
`server/.env` locally, Railway → Variables in prod. Only these; nothing else is read from env.
```
DATABASE_URL=            # Railway Postgres (prod: ${{Postgres.DATABASE_URL}}; local: its public URL)
JWT_SECRET=              # openssl rand -hex 32
APP_ENC_KEY=             # openssl rand -hex 32  (AES-256-GCM key for integration secrets & Google tokens)
PUBLIC_URL=              # https://<app>.up.railway.app  (or tunnel URL locally) — no trailing slash
NODE_ENV=                # production on Railway
GOOGLE_CLIENT_ID=        # platform-level OAuth client (employees each consent individually)
GOOGLE_CLIENT_SECRET=
PORT=                    # Railway sets it; local default 8080
```
Twilio / Stripe / Telegram credentials are **per workspace**, entered on the Integrations page, stored encrypted in `integrations.config_enc` (I5.2, I5.3). Never in env, never sent to the browser, shown only masked (`AC…a1b2`).

---

## 6. File ownership (every file in the repo has exactly one owner)
Push #1 creates **every file below**. Files not yet implemented are **stubs** that export the exact signatures from §9/§10 (server stubs return `501 {error:'Not implemented yet'}` or no-op; page stubs render "Coming soon"). So imports never break and **nobody but Musa ever edits `server/index.js`, `client/src/App.jsx`, `Sidebar.jsx` or `Layout.jsx`** — all routes and pages are pre-registered.

```
/package.json /CLAUDE.md /client/vite.config.js /client/tailwind.config.js        Musa
/README.md /.env.example                                                            Ahmed
server/
  index.js package.json                                                             Musa
  db/index.js db/schema.sql db/seed.js                                              Musa
  db/patches/ali.sql            (extra indexes/columns Ali needs; run after schema) Ali
  middleware/auth.js csrf.js errorHandler.js validate.js                            Musa
  utils/sessionCookie.js refreshToken.js csrf.js jwtSecret.js passwordPolicy.js
        dbSecurity.js audit.js activity.js mask.js crypto.js retry.js format.js      Musa
  services/integrationsStore.js integrationEvents.js metrics.js twilio.js stripe.js Musa
  services/leadEngine.js leadTicker.js notify.js telegram.js google.js              Ali
  routes/auth.js users.js roles.js companies.js contacts.js opportunities.js
         pipelines.js customFields.js savedLists.js notes.js activities.js export.js
         audit.js dashboard.js integrations.js messaging.js payments.js
         webhooksTwilio.js webhooksStripe.js me.js (prefs only)                       Musa
  routes/leads.js publicForms.js availability.js assignmentRules.js
         telegram.js calendar.js appointments.js                                     Ali
  scripts/isolation-test.sh                                                          Musa
client/src/
  App.jsx main.jsx index.css                                                         Musa
  context/AuthContext.jsx ThemeContext.jsx                                           Musa
  utils/api.js csrf.js tokenRefresh.js authSession.js format.js                      Musa
  hooks/useCan.js                                                                    Musa
  components/ui/* (Button Modal Field Input Select Textarea Checkbox DataTable
     Pagination Badge StatCard PageHeader EmptyState Spinner ConfirmDialog)          Musa
  components/Layout.jsx Sidebar.jsx TopBar.jsx                                       Musa
  components/ConversationPanel.jsx PaymentsPanel.jsx                                 Musa
  components/LeadAlerts.jsx AvailabilityToggle.jsx Countdown.jsx
             AppointmentsPanel.jsx BookAppointmentModal.jsx                          Ali
  components/CustomFieldInputs.jsx FilterBar.jsx ActivityTimeline.jsx               Ahmed
  pages/Login.jsx Signup.jsx Inbox.jsx Payments.jsx Audit.jsx
        settings/Users.jsx settings/Roles.jsx settings/Integrations.jsx               Musa
  pages/Leads.jsx LeadDetail.jsx Recovery.jsx PublicForm.jsx Profile.jsx
        settings/AssignmentRules.jsx                                                 Ali
  pages/Dashboard.jsx Contacts.jsx ContactDetail.jsx Companies.jsx
        Opportunities.jsx OpportunityDetail.jsx PipelineBoard.jsx
        settings/Pipelines.jsx settings/CustomFields.jsx                              Ahmed
```

### Client routes (registered in App.jsx by Musa)
| Path | Page | Owner | Nav shown if user can |
|---|---|---|---|
| `/login` `/signup` | Login, Signup | Musa | public |
| `/f/:slug` | PublicForm (no layout) | Ali | public |
| `/` → `/dashboard` | Dashboard | Ahmed | everyone |
| `/leads`, `/leads/:id` | Leads, LeadDetail | Ali | everyone (scope by perm) |
| `/recovery` | Recovery | Ali | `leads.reassign` |
| `/inbox`, `/inbox/:conversationId` | Inbox | Musa | `crm.view` |
| `/contacts`, `/contacts/:id` | Contacts, ContactDetail | Ahmed | `crm.view` |
| `/companies` | Companies | Ahmed | `crm.view` |
| `/opportunities`, `/opportunities/:id` | Opportunities, OpportunityDetail | Ahmed | `crm.view` |
| `/pipeline` | PipelineBoard | Ahmed | `crm.view` |
| `/payments` | Payments | Musa | `crm.view` |
| `/audit` | Audit | Musa | `audit.view` |
| `/profile` | Profile (status, Telegram chat id, Google connect, timezone) | Ali | everyone |
| `/settings/users` `/settings/roles` | Users, Roles | Musa | `users.manage` |
| `/settings/pipelines` `/settings/custom-fields` | Pipelines, CustomFields | Ahmed | `pipeline.manage` |
| `/settings/assignment-rules` | AssignmentRules | Ali | `rules.manage` |
| `/settings/integrations` | Integrations | Musa | `integrations.manage` |

---

## 7. Database — `server/db/schema.sql` (Musa owns; this IS the schema, code against it)
Runs on every boot, idempotent. Conventions: uuid PKs, every business table has `workspace_id`, all times `timestamptz` (stored UTC), money in integer **cents** (`bigint`), editable records have `version int` (optimistic locking), CRM records soft-delete via `deleted_at`.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL, permissions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (workspace_id, name));

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL, email text NOT NULL UNIQUE, password_hash text NOT NULL,
  level text NOT NULL CHECK (level IN ('owner','admin','user')),
  role_id uuid REFERENCES roles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','busy','on_leave','offline')),
  backup_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  manager_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  telegram_chat_id text, timezone text NOT NULL DEFAULT 'Asia/Karachi',
  prefs jsonb NOT NULL DEFAULT '{}', is_active boolean NOT NULL DEFAULT true,
  last_login timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL, domain text, phone text, owner_id uuid REFERENCES users(id),
  custom jsonb NOT NULL DEFAULT '{}', version int NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz);

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  name text NOT NULL, phone text, email text, tags text[] NOT NULL DEFAULT '{}',
  owner_id uuid REFERENCES users(id), source text,
  opted_out boolean NOT NULL DEFAULT false, opted_out_reason text, opted_out_at timestamptz,
  custom jsonb NOT NULL DEFAULT '{}', version int NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_ws_phone ON contacts(workspace_id, phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL, position int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  pipeline_id uuid NOT NULL REFERENCES pipelines(id), name text NOT NULL, position int NOT NULL,
  kind text NOT NULL DEFAULT 'open' CHECK (kind IN ('open','won','lost')),
  required_field_keys text[] NOT NULL DEFAULT '{}');

CREATE TABLE IF NOT EXISTS custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  entity text NOT NULL CHECK (entity IN ('contact','company','opportunity')),
  pipeline_id uuid REFERENCES pipelines(id),   -- only for entity='opportunity'; NULL = all pipelines
  key text NOT NULL, label text NOT NULL,
  type text NOT NULL CHECK (type IN ('text','number','date','dropdown','checkbox')),
  options text[] NOT NULL DEFAULT '{}', position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (workspace_id, entity, key));

CREATE TABLE IF NOT EXISTS opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  contact_id uuid NOT NULL REFERENCES contacts(id), pipeline_id uuid NOT NULL REFERENCES pipelines(id),
  stage_id uuid NOT NULL REFERENCES stages(id), title text NOT NULL,
  value_cents bigint NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'USD',
  owner_id uuid REFERENCES users(id), custom jsonb NOT NULL DEFAULT '{}', version int NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, deleted_at timestamptz);

CREATE TABLE IF NOT EXISTS saved_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id uuid NOT NULL REFERENCES users(id), entity text NOT NULL CHECK (entity IN ('contact','company','opportunity')),
  name text NOT NULL, filters jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  contact_id uuid REFERENCES contacts(id), opportunity_id uuid REFERENCES opportunities(id), lead_id uuid,
  type text NOT NULL,   -- see §10 activity types
  actor_id uuid REFERENCES users(id),  -- NULL = System
  summary text NOT NULL, data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS activities_contact ON activities(workspace_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activities_opp ON activities(workspace_id, opportunity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  actor_id uuid, actor_name text NOT NULL DEFAULT 'System',
  event_type text NOT NULL, target_type text, target_id text,
  before jsonb, after jsonb, ip text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS audit_ws_time ON audit_log(workspace_id, created_at DESC);
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  contact_id uuid NOT NULL REFERENCES contacts(id), opportunity_id uuid REFERENCES opportunities(id),
  source text NOT NULL CHECK (source IN ('web_form','whatsapp','manual')), source_detail text,
  owner_id uuid REFERENCES users(id),        -- single column: two owners is impossible by construction
  first_owner_id uuid REFERENCES users(id),  -- escalation chain (backup/manager) is relative to this person
  status text NOT NULL CHECK (status IN ('assigned','acknowledged','unassigned','closed')),
  assigned_at timestamptz, first_assigned_at timestamptz, first_ack_at timestamptz,
  ack_deadline timestamptz, escalation_level int NOT NULL DEFAULT 0, escalation_count int NOT NULL DEFAULT 0,
  last_action_at timestamptz, version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS leads_due ON leads(status, ack_deadline);

CREATE TABLE IF NOT EXISTS lead_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  lead_id uuid NOT NULL REFERENCES leads(id), from_user_id uuid REFERENCES users(id), to_user_id uuid REFERENCES users(id),
  reason text NOT NULL CHECK (reason IN ('initial','escalation','absence','manual','unassigned')),
  level int NOT NULL DEFAULT 0, actor_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS assignment_rules (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id),
  max_open_leads int NOT NULL DEFAULT 5,
  ack_window_seconds int NOT NULL DEFAULT 60,
  escalation jsonb NOT NULL DEFAULT '[{"to":"next","seconds":45},{"to":"backup","seconds":45},{"to":"manager","seconds":60}]',
  idle_seconds int NOT NULL DEFAULT 600,
  on_absence_acknowledged text NOT NULL DEFAULT 'keep' CHECK (on_absence_acknowledged IN ('keep','reassign')),
  rr_cursor uuid, updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  provider text NOT NULL CHECK (provider IN ('twilio','stripe','telegram','google')),
  status text NOT NULL DEFAULT 'not_connected' CHECK (status IN ('not_connected','connected','error')),
  config_enc text, config_hint jsonb NOT NULL DEFAULT '{}',
  last_ok_at timestamptz, last_error text, last_error_at timestamptz,
  updated_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider));

CREATE TABLE IF NOT EXISTS google_tokens (
  user_id uuid PRIMARY KEY REFERENCES users(id), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  google_email text, refresh_enc text, access_enc text, expires_at timestamptz,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','needs_reconnect')),
  updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS integration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid REFERENCES workspaces(id),
  provider text NOT NULL, direction text NOT NULL CHECK (direction IN ('in','out')),
  kind text NOT NULL, external_id text,
  status text NOT NULL CHECK (status IN ('ok','error','rejected','duplicate','retrying')),
  http_status int, error text, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ie_ws_time ON integration_events(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_dedupe (         -- I1.8 / I2.4: insert inside the processing transaction
  provider text NOT NULL, external_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, external_id));

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  contact_id uuid NOT NULL REFERENCES contacts(id), channel text NOT NULL DEFAULT 'whatsapp',
  assigned_user_id uuid REFERENCES users(id), opportunity_id uuid REFERENCES opportunities(id),
  last_message_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, contact_id, channel));

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id), direction text NOT NULL CHECK (direction IN ('in','out')),
  body text NOT NULL, twilio_sid text UNIQUE,
  status text NOT NULL CHECK (status IN ('received','queued','sent','delivered','read','failed','undelivered')),
  error_code text, error_message text, created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id), contact_id uuid NOT NULL REFERENCES contacts(id),
  requested_by uuid NOT NULL REFERENCES users(id), amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL, description text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','failed','refunded','partially_refunded')),
  stripe_session_id text UNIQUE, stripe_payment_intent text, checkout_url text,
  refunded_cents bigint NOT NULL DEFAULT 0, failure_reason text, paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  contact_id uuid NOT NULL REFERENCES contacts(id), opportunity_id uuid REFERENCES opportunities(id),
  user_id uuid NOT NULL REFERENCES users(id), title text NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, timezone text NOT NULL,
  google_event_id text, status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled')),
  created_by uuid REFERENCES users(id), version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id uuid NOT NULL REFERENCES users(id), lead_id uuid REFERENCES leads(id),
  channel text NOT NULL DEFAULT 'telegram', body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts int NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
```

### Deletion rules (Q4 — nobody leaves orphans)
| Deleting | What happens (owner of the code) |
|---|---|
| Company | soft delete; its contacts get `company_id = NULL` (Musa) |
| Contact | soft delete; its opportunities soft-deleted; its open leads → `closed`; audit `record.deleted` (Musa calls `leadEngine.closeLeadsForContact`) |
| Opportunity | soft delete; pending payments stay visible on payments page (Musa) |
| Stage | `DELETE /stages/:id?move_to=<stageId>` required if it has opportunities; moves them in one transaction; 409 if `move_to` missing (Musa) |
| Custom field | delete definition; remove key from every stage's `required_field_keys`; record values in `custom` stay but are no longer shown (Musa) |
| User | never deleted — deactivate (`is_active=false`) → calls `leadEngine.onStatusChange(ws,userId,'offline')`; Owner cannot be deactivated (Musa) |
| Audit row | impossible (trigger) |

---

## 8. API contract (prefix `/api/v1`)
**Conventions for every endpoint (all owners):**
- Auth: session cookie (httpOnly) + CSRF header `x-csrf-token` on non-GET (client `api.js` does it automatically).
- `req.user = { id, ws, name, email, level, role_id, status, permissions[] }` is loaded **from the DB on every request** by `requireAuth` (permission changes apply instantly; deactivated users are cut off).
- **Every query filters `workspace_id = req.user.ws`.** A record from another workspace → **404** `{error:'Not found'}` (never 403 — don't leak existence).
- Permission missing → **403** `{error:'You need the "<perm>" permission to do this'}`.
- Validation with zod via `validate(schema)` middleware → **400** `{error:'Invalid input', details:{field:'message'}}`.
- Optimistic lock: PATCH body must include `version`; mismatch → **409** `{error:'Someone else changed this record. Reload and try again.', current:{...}}`.
- Lists: `?page=1&limit=25` (max 100) → `{data:[...], total, page, limit}`. Single: `{data:{...}}`.
- Opportunity `value_cents` is **`null` + `value_masked:true`** when the user lacks `opp.value.view` — in lists, detail, `/contacts/:id/full`, dashboard pipeline values, CSV export (always via `maskOpp`).
- SQL only with `$1` params. Never build SQL from user strings (custom-field filters: whitelist keys from `custom_fields`).

### Permissions (F1.3) — exact keys
`crm.view` `crm.create` `crm.edit` `crm.delete` `crm.export` `opp.value.view` `pipeline.manage` `rules.manage` `leads.view_all` `leads.reassign` `integrations.manage` `audit.view` `users.manage`
- **Owner level** = all permissions always (can't be reduced). **Admin / User level** = permissions of their `role`.
- Admin can never edit, deactivate, re-level or re-role the Owner; only the Owner can create another Admin-level user.
- Signup seeds roles: **Admin** (all keys), **Manager** (crm.view/create/edit/export, opp.value.view, leads.view_all, leads.reassign, audit.view), **Sales Rep** (crm.view, crm.create, crm.edit).

### Musa's endpoints
| Method & path | Perm | Body → Response |
|---|---|---|
| POST /auth/signup | public | `{companyName,name,email,password}` → creates workspace + Owner + 3 roles + default pipeline "Sales" (New, Contacted, Proposal, Won[won], Lost[lost]) + `assignment_rules` row; logs in; `{data:user}` |
| POST /auth/login · /auth/logout · /auth/refresh | public | rate-limited (10 / 5 min per IP+email); 15-min access cookie + 7-day rotating refresh cookie |
| GET /auth/me | auth | `{data:{id,name,email,level,status,timezone,prefs,permissions[],workspace:{id,name,slug}}}` |
| GET /users | auth | all active users of ws (`id,name,email,level,role_id,role_name,status,backup_user_id,manager_user_id,telegram_connected,calendar_status,open_leads`) |
| POST /users/invite | users.manage | `{name,email,level,role_id}` → `{data:user, temp_password}` (shown once) |
| PATCH /users/:id | users.manage | `{name?,level?,role_id?,backup_user_id?,manager_user_id?,is_active?}` (status is NOT here — see Ali's `/users/:id/status`) |
| GET/POST /roles · PATCH /roles/:id | users.manage | `{name,permissions[]}` |
| GET/POST /companies · GET/PATCH/DELETE /companies/:id | crm.view/create/edit/delete | filters: `q, owner_id, from, to, field.<key>` |
| GET/POST /contacts · GET/PATCH/DELETE /contacts/:id | crm.* | filters: `q, tag, owner_id, company_id, from, to, field.<key>`; PATCH supports `opted_out, opted_out_reason` |
| GET /contacts/:id/full | crm.view | `{data:{contact, company, opportunities[], conversations[], payments[], appointments[], leads[], assigned_user, activities[]}}` (F2.8) |
| GET/POST /opportunities · GET/PATCH/DELETE /opportunities/:id | crm.* | filters: `q, pipeline_id, stage_id, owner_id, from, to, field.<key>` |
| POST /opportunities/:id/move | crm.edit | `{stage_id, version}` → **422** `{error:'Fill these fields before moving to <stage>', missing:[{key,label}]}` if required fields empty (F2.4) |
| GET/POST /pipelines · PATCH/DELETE /pipelines/:id | view: crm.view, write: pipeline.manage | |
| POST /pipelines/:id/stages · PATCH /stages/:id · PUT /pipelines/:id/stages/order `{ids:[]}` · DELETE /stages/:id?move_to= | pipeline.manage | stage: `{name, kind, required_field_keys[]}` |
| GET /custom-fields?entity=&pipeline_id= · POST · PATCH/DELETE /custom-fields/:id | view: crm.view, write: pipeline.manage | `{entity,pipeline_id?,label,type,options[]}` (key auto-slugged from label) |
| GET/POST /saved-lists · DELETE /saved-lists/:id | crm.view | `{entity,name,filters}` — filters = same query params as the list endpoint; opening a list re-runs them (auto-updates, F2.6) |
| POST /notes | crm.edit | `{contact_id?, opportunity_id?, body}` → activity `note` + `leadEngine.recordAction` |
| GET /activities?contact_id=&opportunity_id= | crm.view | time-ordered desc (F2.7) |
| GET /export/:entity.csv (contacts/companies/opportunities) | crm.export | same filters as list; values masked; audit `export.performed` |
| GET /audit?event_type=&user_id=&from=&to=&page= | audit.view | read-only. **No PUT/PATCH/DELETE route exists.** |
| GET /dashboard | auth | see §11; Owner/Admin-level → company-wide, User-level → personal |
| PUT /me/prefs | auth | `{dashboard_hidden:[keys]}` (F5.5) |
| GET /integrations | integrations.manage | per provider: `{provider,status,config_hint,last_ok_at,last_error,last_error_at,limits:[strings]}` |
| PUT /integrations/:provider · DELETE /integrations/:provider | integrations.manage | twilio `{account_sid,auth_token,from}`, stripe `{secret_key,webhook_secret}`, telegram `{bot_token}`; validates by a test call; audit `integration.*` |
| GET /integration-events?provider=&status=&page= | integrations.manage | I5.4 sync history |
| GET /conversations?mine=1 · GET /conversations/:id/messages | crm.view (+ only own unless `leads.view_all`) | I1.6 |
| POST /conversations/:id/messages · POST /contacts/:id/messages | crm.edit | `{body}`; blocked with 422 + reason if `opted_out` (I1.9) |
| POST /messages/:id/retry | crm.edit | only for `failed/undelivered` (I1.7) |
| POST /webhooks/twilio/:wsId · POST /webhooks/twilio/:wsId/status | public, signature-checked | |
| POST /opportunities/:id/payments | crm.edit | `{amount_cents,currency,description?}` → `{data:{...payment, checkout_url}}` |
| GET /payments?status=&page= | crm.view | each row: opportunity, contact, requested_by name, stripe ref (I2.7) |
| POST /payments/:id/send-whatsapp | crm.edit | sends checkout_url to contact via Twilio |
| POST /webhooks/stripe/:wsId | public, raw body, signature-checked | |

### Ali's endpoints
| Method & path | Perm | Body → Response |
|---|---|---|
| GET /public/forms/:slug | public | `{data:{workspace_name}}` |
| POST /public/forms/:slug/lead | public, rate-limited 20/10 min/IP, honeypot field `website` must be empty | `{name,email?,phone?,message?}` → match contact by phone then email, else create → `createLead(source 'web_form')` → `{data:{ok:true}}` |
| POST /leads | crm.create | manual: `{contact_id}` or `{name,phone?,email?}` + `{note?}` → source `manual` |
| GET /leads?scope=mine\|all&status=&page= | mine: auth; all: leads.view_all | rows incl. `owner_name, contact_name, seconds_left, escalation_level, source` |
| GET /leads/:id | owner or leads.view_all | lead + contact + assignment history |
| POST /leads/:id/ack | current owner only | sets acknowledged |
| POST /leads/:id/reassign | leads.reassign | `{user_id, version}` → reason `manual` |
| POST /leads/:id/close | owner or leads.reassign | |
| GET /leads/recovery | leads.reassign | `{data:[{...lead, reasons:['Unacknowledged past window','Escalated 2+ times','No action for 10 min']}]}` |
| GET /assignment-rules · PUT /assignment-rules | view: auth, write: rules.manage | timers in **seconds** |
| PATCH /me/status · PATCH /users/:id/status | self / users.manage or leads.reassign | `{status}` → `onStatusChange` |
| PUT /me/telegram `{chat_id}` · POST /me/telegram/test | auth | test sends a hello message |
| GET /notifications?status= | integrations.manage | failed alerts visible to Admins (I4.4) |
| GET /integrations/google/connect | auth | redirects to Google consent (state = signed JWT `{uid,ws}`, 10 min) |
| GET /integrations/google/callback | public (state-verified) | stores tokens → redirect `/profile?google=connected` |
| DELETE /integrations/google | auth | revoke + delete own tokens |
| GET /calendar/busy?user_id=&from=&to= | crm.view | `{data:{status:'ok'\|'not_connected'\|'needs_reconnect', busy:[{start,end}]}}` |
| GET /appointments?contact_id=&opportunity_id=&upcoming=1 | crm.view | |
| POST /appointments | crm.edit | `{contact_id,opportunity_id?,user_id,title,starts_at(ISO with offset),ends_at,timezone,force?}` → **409** `{error:'Overlaps with a busy slot', conflicts:[...]}` unless `force:true` |
| PATCH /appointments/:id `{starts_at,ends_at,title,version}` · DELETE /appointments/:id | crm.edit | updates/cancels the Google event; activity + audit |

---

## 9. Cross-module server functions (fixed signatures — stubs exist from push #1)
Every function takes an optional `client` (pg client inside a transaction). If given, use it; else use the pool.

**`services/leadEngine.js` (Ali)**
```js
createLead({ ws, contactId, source, sourceDetail, opportunityId = null, actorId = null, client })  // → lead row; assigns immediately (or status 'unassigned' if nobody eligible → recovery)
recordAction({ ws, contactId, userId, kind, client })   // kind: 'note'|'message'|'stage'|'appointment'|'call'
   // sets last_action_at on the contact's open leads; if userId is the current owner and lead is 'assigned' → acknowledged (glossary "Acknowledged")
onStatusChange({ ws, userId, status, actorId })        // F3.6
closeLeadsForContact({ ws, contactId, client })         // used by contact delete
```
**`services/notify.js` (Ali)** `escalation({ ws, userId, lead, reason })` → inserts `notifications` row (ticker sends + retries).
**`services/google.js` (Ali)** `getBusy({ws,userId,from,to})`, `createEvent(...)`, `updateEvent(...)`, `deleteEvent(...)`.

**`utils/audit.js` (Musa)** `audit(reqOrNull, { ws, event_type, target_type, target_id, before, after }, client)` — `reqOrNull=null` → actor "System".
**`utils/activity.js` (Musa)** `logActivity({ ws, contact_id, opportunity_id, lead_id, type, actor_id, summary, data }, client)`
**`utils/mask.js` (Musa)** `maskOpp(row, req)` / `maskOpps(rows, req)`
**`utils/crypto.js` (Musa)** `encrypt(obj|string) → string`, `decrypt(string) → obj|string`
**`utils/retry.js` (Musa)** `withRetry(fn, { attempts: 3, baseMs: 500, isTemporary: (err) => bool })` — temporary = network error, 429, 5xx (I5.5)
**`services/integrationsStore.js` (Musa)** `getConfig(ws, provider) → obj|null`, `markOk(ws, provider)`, `markError(ws, provider, message)`
**`services/integrationEvents.js` (Musa)** `recordEvent({ ws, provider, direction, kind, external_id, status, http_status, error, detail })` — **every** inbound webhook and outbound provider call (incl. Ali's Telegram & Google calls) must call this (I5.4).
**`services/twilio.js` (Musa)** `sendWhatsApp({ ws, contactId, body, userId }) → message row` — the only place that talks to Twilio; nobody else re-implements it.
**`client/src/utils/api.js` (Musa)** exports `apiFetch(path, opts)`, `apiGet(path)` (also the SWR fetcher), `apiPost(path, body)`, `apiPatch(path, body)`, `apiDelete(path)` — all throw `Error(serverErrorText)` with `.status` and `.details` attached; CSRF + refresh handled inside.
**`middleware/auth.js` (Musa)** `requireAuth`, `requirePerm(...keys)` (all required), `hasPerm(req, key)`
**`middleware/validate.js` (Musa)** `validate({ body?, query?, params? })` with zod schemas

### Audit events (F4.1) — who writes which (`event_type` exact strings)
- Musa: `user.invited`, `user.updated` (level/role/backup/manager changes with before/after), `user.deactivated`, `role.created`, `role.permissions_changed`, `field.created|updated|deleted`, `pipeline.created|updated|deleted`, `stage.created|updated|reordered|deleted`, `record.deleted` (contact/company/opportunity), `export.performed`, `integration.connected|updated|disconnected`, `webhook.rejected`, `auth.login_failed`
- Ali: `lead.created`, `lead.assigned`, `lead.acknowledged`, `lead.escalated`, `lead.reassigned_absence`, `lead.reassigned_manual`, `lead.unassigned`, `user.status_changed`, `rules.updated`, `integration.google_connected|google_disconnected`, `appointment.created|updated|cancelled`
### Activity types (F2.7) — timeline entries
`note` `stage_change` `field_edit` `assignment` `lead_created` `acknowledged` `escalation` `message_in` `message_out` `payment` `appointment` — Musa writes note/stage_change/field_edit/message_*/payment; Ali writes lead_*/assignment/acknowledged/escalation/appointment.
### Who calls `recordAction` (acknowledgement by action)
Musa: `POST /notes`, outbound message send, `/opportunities/:id/move`. Ali: `POST /appointments`.

---

## 10. Lead engine spec (Ali implements; everyone else just needs to know the behaviour)
- **Eligible employee** = active, `status='available'`, open leads (`assigned`+`acknowledged` owned) `< max_open_leads`.
- **Assign** (inside `withTransaction`): `SELECT * FROM assignment_rules WHERE workspace_id=$1 FOR UPDATE` (serialises concurrent assignments per workspace) → round-robin over eligible users ordered by `id` starting after `rr_cursor` → set `owner_id, first_owner_id (if null), assigned_at=now(), first_assigned_at (if null), ack_deadline=now()+ack_window_seconds, status='assigned', escalation_level=0, version+1` → `lead_assignments`, audit, activity, update `rr_cursor`. Nobody eligible → `status='unassigned'`, `owner_id=NULL` (shows in recovery with reason).
- **Ticker** (`leadTicker.start()` called once in `server/index.js` after DB init; `setInterval` 2000 ms + one immediate run): in a transaction `SELECT id, version FROM leads WHERE status='assigned' AND ack_deadline < now() FOR UPDATE SKIP LOCKED LIMIT 20`, escalate each with `UPDATE ... WHERE id=$1 AND version=$2` (0 rows → someone else did it → skip). This makes it restart-safe (deadlines live in DB) and duplicate-safe (Q5, F3.8).
- **Escalation chain** (F3.5): level i uses `escalation[i-1]` → `to:'next'` = next eligible employee (round-robin, excluding current owner), `to:'backup'` = `first_owner.backup_user_id` if not on_leave/offline, `to:'manager'` = `first_owner.manager_user_id` if not offline (cap ignored for manager). Target missing/ineligible → skip to the following level. Past the last level → `status='unassigned'`, owner NULL. Each step: `escalation_count+1`, new `ack_deadline = now()+seconds`, audit `lead.escalated` (actor System, before/after owner), activity, `notify.escalation(...)`.
- **Absence** (F3.6): `onStatusChange` to `on_leave`/`offline` → immediately reassign every `assigned` lead of that user (reason `absence`). Acknowledged leads: `keep` (default; they stay with the person and are flagged in recovery after idle time) or `reassign` (moved too). The current rule is shown on Leads page and Profile.
- **Recovery queue** (F3.7): `status='unassigned'` OR (`status='assigned'` AND `ack_deadline < now()`) OR `escalation_count >= 2` OR (`status IN ('assigned','acknowledged')` AND `coalesce(last_action_at, assigned_at) < now() - idle_seconds`). Each row lists every matching reason.
- **Telegram** (I4): ticker also sends `notifications` where `status IN ('pending','failed') AND attempts < 3 AND next_attempt_at <= now()`: POST `https://api.telegram.org/bot<token>/sendMessage` `{chat_id, text}`. Text (I4.2): `⚠️ Lead escalated to you: <contact name> (source: <source>). Reason: <reason>. Open: <PUBLIC_URL>/leads/<id>`. Fail → `attempts+1`, `next_attempt_at = now() + 10s * attempts`, `last_error`; after 3 → `failed` (visible to Admins on Integrations page via `/notifications`). User without chat_id → `skipped` with reason. Every call → `recordEvent`.
- **UI**: `Countdown` shows mm:ss to `ack_deadline` (red under 10 s, text "Overdue" when negative — not color only). `LeadAlerts` (mounted in Layout) polls `GET /leads?scope=mine&status=assigned` every 3 s and toasts "New lead assigned: <name>" for unseen ids.

## 11. Dashboard & metric definitions (Section 7 of the brief — one meaning everywhere)
All computed in `services/metrics.js` (Musa) and reused by drill-down list filters so figure = list count (Q12). Times in workspace day boundaries using the viewer's timezone.
| Key | Definition | Drill-down |
|---|---|---|
| `new_leads_today` | leads created today | `/leads?scope=all&created=today` |
| `open_pipeline_by_stage` | sum `value_cents` of non-deleted opps in `open`-kind stages, grouped by stage; `null` if no `opp.value.view` | `/opportunities?stage_id=` |
| `avg_first_response_seconds` | avg(`first_ack_at - first_assigned_at`) of leads first-acknowledged in last 30 days | — |
| `recovery_count` | rows in recovery queue (§10 definition) | `/recovery` |
| `escalations_24h` | `lead_assignments` reason `escalation` in last 24h (manual counted separately as `manual_reassignments_24h`) | `/leads?scope=all&escalated=24h` |
| `availability` | count of users per status + list | `/settings/users` |
| `upcoming_appointments` | next 5 `scheduled` with `starts_at > now()` | `/contacts/:id` |
| `collected_this_month_cents` | sum `amount_cents` of payments with `paid_at` this month and status paid/partially_refunded/refunded **minus** `refunded_cents` — Stripe-webhook-confirmed only (I2.6) | `/payments?status=paid` |
| `projected_cents` | open pipeline value + pending payment requests | — |
User-level → each figure filtered to their own leads/opps/appointments. Response: `{data:{scope:'company'|'personal', figures:{key: value,...}, hidden:[keys]}}`.

---

## 12. Integration specifics (owners implement; listed so nobody guesses)
**Twilio WhatsApp (Musa)** — webhook URL `PUBLIC_URL/api/v1/webhooks/twilio/<wsId>`.
1. Load config for wsId (404 if none). `twilio.validateRequest(auth_token, req.header('X-Twilio-Signature'), PUBLIC_URL + req.originalUrl, req.body)`; false → 403, `recordEvent(status 'rejected')`, audit `webhook.rejected` (I1.2).
2. Transaction: `INSERT INTO webhook_dedupe ('twilio', MessageSid) ON CONFLICT DO NOTHING` → 0 rows → `recordEvent('duplicate')`, return 200 (I1.8).
3. `From` `whatsapp:+923...` → E.164 → contact by phone; none → create contact (source whatsapp) + `createLead` (I1.5). Body `STOP` → `opted_out=true`.
4. Upsert conversation, insert message `received`, activity `message_in`, `last_message_at`. Return empty TwiML 200.
- Send: `client.messages.create({from, to:'whatsapp:'+phone, body, statusCallback: PUBLIC_URL+'/api/v1/webhooks/twilio/<wsId>/status'})` with `withRetry`; permanent failure → message `failed` with Twilio error code/message, Retry button (I1.7). Status callback → update status (signature-checked too) (I1.4).
- Limits text (I5.6): "Sandbox only reaches phones that sent the join phrase; free-form replies only within 24 h of the customer's last message."

**Stripe (Musa)** — webhook URL `PUBLIC_URL/api/v1/webhooks/stripe/<wsId>`, events: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed`, `payment_intent.payment_failed`, `charge.refunded`.
- Route mounted with `express.raw({type:'application/json'})` **before** `express.json`. `stripe.webhooks.constructEvent(rawBody, sig, webhook_secret)` before touching anything (I2.3). Dedupe on `event.id` via `webhook_dedupe` (I2.4).
- Create: `checkout.sessions.create({mode:'payment', line_items:[{price_data:{currency, unit_amount, product_data:{name}}, quantity:1}], metadata:{payment_id, ws}, success_url: PUBLIC_URL+'/payments?paid=1', cancel_url: ..., expires_at: now+30min})`. Never touch card data (I2.8).
- Map: completed → `paid` (+paid_at, payment_intent); expired → `expired`; failed → `failed` + reason; refunded → `refunded`/`partially_refunded` + `refunded_cents`. Each → activity `payment`.
- Limits: "Test mode: use card 4242 4242 4242 4242, any future date, any CVC."

**Google Calendar (Ali)** — redirect URI `PUBLIC_URL/api/v1/integrations/google/callback`, scopes `calendar.events`, `calendar.readonly` (freebusy), `openid email`. `access_type:'offline', prompt:'consent'`. Tokens encrypted in `google_tokens`. Before each call refresh if `expires_at < now()+60s`; `invalid_grant` → `status='needs_reconnect'` shown on Profile and Users page (I3.2, I3.7). Busy check via `freebusy.query` (I3.4). Store `starts_at` timestamptz + IANA `timezone`; send `{dateTime, timeZone}` to Google; display in viewer's timezone with the zone label (I3.5). Limits: "App is in Google testing mode — only listed test users can connect; refresh tokens may expire after 7 days."

**Telegram (Ali)** — see §10. Limits: "Each employee must message the bot once (/start) and enter their chat ID on Profile."

**Isolation of failures (I5.8)**: every provider call wrapped in try/catch + `withRetry`; a provider being down marks that integration `error` and never throws out of unrelated routes or the ticker.

---

## 13. Per-person work lists (requirement IDs in brackets)

### MUSA — owns F1, F2 backend, F4, F5 backend, I1, I2, I5, Q1, Q13 seed, isolation test
Push #1 (T+0:35):
- [ ] Copy from `/Users/musa/rsfm/server`: `utils/{sessionCookie,refreshToken,csrf,jwtSecret,passwordPolicy,dbSecurity}.js`, `middleware/{csrf,errorHandler}.js`, `db/index.js` (remove farm `ensure*`), auth route skeleton (keep login/limiter/refresh/logout/me; delete PIN + 2FA). JWT payload `{id, ws}` only. `refreshToken.js` join → `users`.
- [ ] Copy from `/Users/musa/rsfm/client/src`: `utils/{api,csrf,tokenRefresh,authSession}.js` (`API_BASE='/api/v1'`), `context/{AuthContext,ThemeContext}.jsx` (remove PIN), `components/{Layout,Sidebar,TopBar,PageHeader,StatCard}.jsx`, `tailwind.config.js`. **Do NOT copy** `sessionLifecycle.js` or `installFetchAuth.js` logout-on-close (they break F1.1) or `usePermissions/navAccess` (role-name checks violate F1.3).
- [ ] `schema.sql` exactly as §7; `index.js` mount order: helmet → trust proxy → cookieParser → **webhooks (raw) + public routes** → `express.json` → CSRF → auth routes → `requireAuth` → all other routes → static `client/dist` + SPA fallback → errorHandler; start `leadTicker`.
- [ ] signup (one transaction), users/invite, roles, `requirePerm`, `useCan()` hook, Owner protection (F1.1, F1.2, F1.3, F1.5, F1.6, Q1)
- [ ] `audit.js`, `activity.js`, `mask.js`, `crypto.js`, `retry.js`, `integrationsStore.js`, `integrationEvents.js`, `validate.js`
- [ ] UI kit `components/ui/*` (props in §13 Ahmed section), Login, Signup, Users, Roles pages
- [ ] **all stubs** from §6 with exact §9 signatures; all routes/pages registered; Sidebar filtered by `useCan`
- [ ] `seed.js`: workspace "Acme Solar" (owner@acme.test / Demo1234!, admin ali@acme.test, users ahmed@acme.test + rep2@acme.test, all `Demo1234!`, backup/manager set), 20 contacts, 8 opps, 2nd pipeline "Installations" with its own custom field; workspace "Beta Realty" (owner@beta.test) for isolation tests
Push #2 (T+1:00): companies, contacts, opportunities, move+required fields, pipelines/stages (reorder, safe delete), custom fields, saved lists, notes, activities, export (F1.4, F2.1–F2.7, Q4, Q9)
Then: Twilio (I1.1–I1.9) → Stripe (I2.1–I2.8) → Integrations page + event log (I5.1–I5.8) → Inbox page, ConversationPanel, PaymentsPanel, Payments page → `/dashboard` + `metrics.js` (F5.1–F5.4) → `/contacts/:id/full` (F2.8) → Audit page with filters (F4.2) → `scripts/isolation-test.sh` (curl: log in as Beta owner, GET/PATCH/DELETE 3 Acme ids → expect 404; log in as Acme Sales Rep, DELETE contact → 403, GET opportunity → value null; PATCH /audit → 404 route) (F1.5, F1.6, F4.3, Q2).
Use Opus for: auth/permissions, webhooks, metrics. Sonnet is fine for CRUD routes and pages.

### ALI — owns F3 (all), F4 lead events, I3, I4, Q5 timers
**Prompt to start Claude Code (Opus):** "Read CLAUDE.md §1–§12 and the ALI list in §13. Implement only files Ali owns in §6. Start with `services/leadEngine.js` and `services/leadTicker.js` exactly per §9–§10. Use `db/index.js` helpers `queryOne/queryAll/queryRun/queryInsert/withTransaction(cb(client))`. Use `audit()`, `logActivity()`, `recordEvent()`, `getConfig()` from Musa's utils — if they're still stubs, call them anyway with the §9 signatures."
- [ ] `leadEngine.js`: createLead, assign, recordAction, onStatusChange, closeLeadsForContact (F3.1, F3.3, F3.6, F3.8)
- [ ] `leadTicker.js`: escalation + notification sending/retry, 2 s interval, SKIP LOCKED + version check (F3.4, F3.5, F3.9, Q5, I4.1, I4.4)
- [ ] `patches/ali.sql` only if you need extra indexes (no table changes without telling Musa)
- [ ] routes: leads, publicForms, availability, assignmentRules, telegram (`/me/telegram`, `/notifications`) (F3.1–F3.7, I4.3)
- [ ] pages/components: Leads (tabs Mine/All, Countdown, Ack, Reassign dropdown, "Acknowledged leads on absence: kept/reassigned" note), LeadDetail (history timeline), Recovery (reasons as text badges), AssignmentRules (seconds inputs, escalation levels add/remove/reorder), Profile (status switch, timezone, Telegram chat id + test, Google connect/disconnect + status), PublicForm (`/f/:slug`), LeadAlerts, AvailabilityToggle (also in TopBar slot) (F3.2, F3.4, F3.7, Q11)
- [ ] Google: `services/google.js`, routes calendar + appointments, `AppointmentsPanel`, `BookAppointmentModal` (pick employee → show busy slots → warn on overlap → create; reschedule/cancel) (I3.1–I3.7)
- [ ] Dev trick for demo: rules default `ack_window_seconds=60`; set to 20 during demo.
Switch to Sonnet for pages; keep Opus for engine/ticker/Google token handling.

### AHMED — owns accounts, CRM UI, dashboard UI, detail pages, README, QA
**A. Accounts (T+0:00–0:35, no AI needed).** Send every secret to Musa & Ali privately (WhatsApp), never in git.
1. Ask Ali to add you as repo collaborator.
2. **Railway**: New Project → Deploy from GitHub repo `Buisness-Management-Platform` → add PostgreSQL. Service Variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `JWT_SECRET`, `APP_ENC_KEY` (each `openssl rand -hex 32`), `NODE_ENV=production`, `PUBLIC_URL` (Settings → Networking → Generate Domain, then paste `https://...`). Build command `npm run build`, start `npm start`. Postgres → Connect → copy the **public** URL and send it to the team for local `.env`.
3. **Twilio**: sign up → Messaging → Try it out → WhatsApp sandbox. All 3 of us send the join phrase from our phones. Copy Account SID, Auth Token, sandbox number (`whatsapp:+14155238886`).
4. **Stripe**: sign up, stay in **Test mode** → Developers → API keys → copy `sk_test_...`.
5. **Google Cloud**: new project → enable "Google Calendar API" → OAuth consent screen: External, Testing, add **all 3 team Gmails as test users** → Credentials → OAuth client ID (Web) → Authorized redirect URI `PUBLIC_URL/api/v1/integrations/google/callback` → put `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in Railway variables.
6. **Telegram**: @BotFather → /newbot → copy token. Each of us messages the new bot `/start`, and gets our chat id from @userinfobot.
7. After first deploy: open the app → Sign up "Acme Solar" → Settings → Integrations shows the workspace id → (a) Twilio sandbox settings "When a message comes in" = `PUBLIC_URL/api/v1/webhooks/twilio/<wsId>` (POST); (b) Stripe → Developers → Webhooks → Add endpoint `PUBLIC_URL/api/v1/webhooks/stripe/<wsId>`, events listed in §12 → copy `whsec_...`; (c) paste Twilio, Stripe (sk + whsec), Telegram token into Integrations page.

**B. Pages (from T+1:00).** One chat per file. Every chat starts with this paste, then the page request:
> "I'm building a React 19 + Vite + Tailwind app. Here are the project rules, API and tables: [paste §8 conventions + the endpoint rows you need + §7 tables you need]. Here is our api helper: [paste `client/src/utils/api.js`]. Here is our UI kit usage and an example page: [paste the UI kit list below + `client/src/pages/settings/Users.jsx`]. Write the COMPLETE file `client/src/pages/<Name>.jsx`. Rules: data via `useSWR(path, apiGet)`; mutations via `apiPost/apiPatch/apiDelete` then `mutate()`; toasts via `toast.success/toast.error` from 'sonner' showing the server's `error` text; use `useCan()` to hide buttons the user can't use; every input inside `<Field label>`; must work at 375 px wide with no horizontal scroll (tables become cards on mobile — DataTable does this); buttons show loading state; empty and error states shown; never use dangerouslySetInnerHTML."

UI kit (Musa ships it; use only these): `<PageHeader title subtitle actions/>`, `<Button variant="primary|secondary|danger|ghost" loading disabled onClick/>`, `<Modal open onClose title>`, `<Field label error hint>`, `<Input/> <Select options=[{value,label}]/> <Textarea/> <Checkbox label/>`, `<DataTable columns=[{key,label,render}] rows loading empty onRowClick/>`, `<Pagination page limit total onChange/>`, `<Badge tone="gray|green|yellow|red|blue">text</Badge>`, `<StatCard label value hint onClick/>`, `<EmptyState title body action/>`, `<Spinner/>`, `<ConfirmDialog/>`. Helpers: `money(cents, currency)`, `dateTime(iso)`, `relative(iso)` from `utils/format.js`; `useAuth()` → `user`; `useCan()` → `can('crm.edit')`.

Pages in this order (requirement IDs to satisfy):
1. `components/CustomFieldInputs.jsx` — renders inputs for a list of custom field definitions by type (text/number/date/dropdown/checkbox), value object in/out (F2.2)
2. `components/FilterBar.jsx` — search + tag + owner + stage + date range + one custom field; "Save as list" → `POST /saved-lists`; "My lists" dropdown re-applies filters (F2.6)
3. `Contacts.jsx` — list, pagination, FilterBar, create/edit modal with company select + tags + CustomFieldInputs, Export CSV button if `can('crm.export')` (F2.1, F2.2, Q9)
4. `Companies.jsx` — list + modal; shows contact count (F2.1)
5. `Opportunities.jsx` — list; pipeline selector changes which custom fields show (F2.3); value shows "Hidden" when `value_masked` (F1.4)
6. `PipelineBoard.jsx` — pipeline selector, one column per stage (horizontal scroll inside the board only), card has "Move to…" select → `POST /opportunities/:id/move`; on 422 show "Fill: X, Y" and open edit modal (F2.4, F2.5)
7. `settings/Pipelines.jsx` — pipelines + stages: add, rename, kind, required fields (multi-select of opportunity custom fields), up/down reorder, delete asks "move existing opportunities to…" (F2.5, F2.4)
8. `settings/CustomFields.jsx` — add/edit/delete; entity select; for opportunity, pipeline select (or "All pipelines") (F2.2, F2.3)
9. `components/ActivityTimeline.jsx` — `GET /activities?contact_id|opportunity_id`, icon + text label per type, who, when (F2.7)
10. `Dashboard.jsx` — `GET /dashboard` every 10 s; StatCards; pipeline-by-stage bar (recharts); availability list; upcoming appointments; collected vs projected; ≥3 cards clickable to drill-down routes in §11; "Customize" toggles hidden keys → `PUT /me/prefs` (F5.1–F5.5)
11. `ContactDetail.jsx` — `GET /contacts/:id/full`; sections: details (edit, opt-out toggle with reason), assigned employee, opportunities, `<ConversationPanel contactId/>`, `<PaymentsPanel contactId/>`, `<AppointmentsPanel contactId/>`, `<ActivityTimeline contactId/>`, "Add note" box (F2.8, I1.9)
12. `OpportunityDetail.jsx` — details + stage move + `<PaymentsPanel opportunityId/>` + "Book appointment" (`<BookAppointmentModal/>`) + timeline (I2.1, I3.3)

**C. 3:15–3:40**: run §15 on the deployed URL on phone + laptop, keyboard-only once (Tab through Contacts page). Write `README.md` (what it is, setup: clone → `server/.env` from `.env.example` → `npm i` in server & client → `node server/db/seed.js` → run both; demo logins; integration setup steps from A) and `.env.example` with §5 names (Q13).

---

## 14. Cut line (apply from the top, only if behind at T+2:15 — tell the team in chat)
1. Telegram `/start` deep-link pairing → keep manual chat id field.
2. Google conflict check blocks → warn only.
3. Saved lists → keep "Save" + "My lists" dropdown, no management page.
4. Company page extras, dark mode, animations.
5. Partial refund display → treat any refund as `refunded`.
**Never cut**: escalation demo, workspace isolation, server-side perms + masking, webhook signature + dedupe, append-only audit, restart-safe timers.

## 15. Demo / acceptance checklist (Ahmed runs at 3:15; we present it in this order)
1. Sign up workspace → refresh page → still logged in. Invite a Sales Rep; remove `opp.value.view` from their role → value hidden in list, detail, CSV. (F1.1–F1.4)
2. `bash server/scripts/isolation-test.sh` → all cross-workspace calls 404, unauthorized delete 403. (F1.5, F1.6, Q2)
3. Add custom field "Roof size" to Installations pipeline only → Sales pipeline doesn't show it; make it required for "Proposal" → move blocked with message. Rename/reorder/delete a stage with cards. (F2.2–F2.5)
4. Filter contacts by 3 criteria → save list → create a matching contact → it appears in the list. (F2.6)
5. Rules: ack window 20 s. Submit `/f/acme-solar` → lead assigned with countdown → wait → escalates → Telegram message arrives within seconds → audit shows `lead.escalated` by System. (F3.1, F3.3–F3.5, F3.9, I4)
6. Set a rep On leave → their unacknowledged leads move instantly; recovery queue shows reasons. (F3.6, F3.7)
7. Railway → restart service during a countdown → escalation still fires once. Two leads expiring together → no double escalation. (Q5, F3.8)
8. WhatsApp from an unknown phone → new contact + lead appear without refresh; reply from Inbox → delivered tick; resend same webhook (curl) → no duplicate; forged request → rejected + logged; opted-out contact → send blocked with reason. (I1)
9. Payment link from opportunity → pay 4242… → status Paid without refresh → dashboard collected rises → refund in Stripe dashboard → Refunded. (I2)
10. Connect Google → book over a busy slot (warning) → book free slot → shows in Google Calendar + contact page → reschedule → Google updates. (I3)
11. Integrations page: statuses, last success, recent errors, event history, limits text. (I5)
12. Dashboard as Owner vs Sales Rep; click 3 figures → filtered lists match numbers; hide a card → refresh → still hidden. (F5)
13. Audit page filters by type/user/date; `curl -X DELETE /api/v1/audit/...` → 404; DB `DELETE FROM audit_log` → error. (F4)
14. Phone width: every page usable, no horizontal scroll; Tab through a form. (Q7, Q8)
