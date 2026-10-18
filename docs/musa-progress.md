# Musa's lane: progress report (Sun 18 Oct 2026, ~14:15)

Scope: only Musa's part of CLAUDE.md. Everything below is on `main` unless it says otherwise.

## Provider decisions (final)
- Messaging is the workspace Telegram bot. Twilio is gone.
- Payments are Google Pay in the TEST environment. Stripe is gone.
- Hosting is Vercel. The database is Supabase. Railway is dropped.
- `railway.json` still exists in the repo and should be deleted.
- CLAUDE.md still mentions Railway in places and needs a tidy.

## Done and pushed

**Foundation**
- Signup creates a workspace, an Owner, 3 roles, a default "Sales" pipeline and the assignment rules row.
- Login uses a 15-minute access cookie and a 7-day rotating refresh cookie. Login is rate limited, and CSRF is on all writes.
- Every request reloads the user from the database, so permission changes apply at once.
- The 13 permission keys are enforced on the server. Owner has all of them. Admin can never edit the Owner.
- Another workspace's record always returns 404, never 403.
- The audit log is append-only. A database trigger blocks UPDATE and DELETE, and there is no PUT/PATCH/DELETE route for it.
- Opportunity values are masked (`value_cents: null`, `value_masked: true`) in lists, detail, export and the dashboard when the user lacks `opp.value.view`.

**CRM backend**
- Companies, contacts, opportunities, pipelines and stages, custom fields, saved lists, notes, activities and CSV export.
- Filters work, including custom-field filters.
- Moving an opportunity returns 422 with a `missing[]` list when required fields are empty.
- Optimistic locking returns 409 with the current record.
- Deleting a stage needs `move_to`. Deletes are soft and leave no orphans.
- `GET /contacts/:id/full` returns the whole customer view.

**Telegram messaging**
- Customers message the bot, which creates a contact and a lead with source `telegram`.
- Two-way chat works through `POST /conversations/:id/messages` and `POST /contacts/:id/messages`.
- The webhook is verified with the `X-Telegram-Bot-Api-Secret-Token` header. The secret is derived from `APP_ENC_KEY`, and the webhook is registered automatically when an admin saves the bot token.
- Replays are deduplicated on `update_id`. `/stop` opts the contact out, `/start` opts back in, and `/myid` returns the sender's chat ID.
- Employee chats never become leads.
- Failed sends show a Retry button.

**Google Pay (TEST)**
- Creating a payment request makes a link `PUBLIC_URL/pay/<token>` that expires after 30 minutes.
- The public pay page opens the real Google Pay sheet.
- The server verifies the Google signature chain (ECv2). The same token twice does nothing.
- Refunds are recorded in-app, because the TEST environment has no refund API. Each one is audited.
- Payments can be sent to the customer over Telegram.

**Integrations page**
- Telegram and Google Pay cards with masked secrets, the webhook URL to copy, sync history and failed alerts.
- Every inbound webhook and outbound provider call is logged in `integration_events`.
- Temporary failures are retried three times. A provider being down never breaks unrelated routes.

**Dashboard backend**
- `GET /dashboard` returns company-wide figures for Owner/Admin and personal figures for users.
- Each figure has a written definition and a drill-down link.
- `PUT /me/prefs` saves hidden cards.

**Pages and components**
- Login, Signup, Users, Roles, Integrations, Inbox, Payments, Audit, PayPage, `ConversationPanel` and `PaymentsPanel`.
- The shared UI kit, layout and routing are in place.

**Seed and tests**
- `node server/db/seed.js [--reset]` creates Acme Solar and Beta Realty. All demo logins use the password `Demo1234!`: owner@acme.test, ali@acme.test, manager@acme.test, ahmed@acme.test, rep2@acme.test, owner@beta.test and rep@beta.test.
- `bash server/scripts/isolation-test.sh` passed 20/20 locally.
- It has not been re-run since the dashboard and UI pushes.

**Deploy files**
- `api/index.js` and `vercel.json` are written for Vercel.
- `server/app.js` is the Express app, and `server/index.js` is the local entry.

## What I tested, and what I have not

Tested locally against a local Postgres:
- Login, CSRF and permissions.
- CRM filters, masking, 422 and 409 handling.
- The Telegram webhook: valid, replay, forged, and `/stop`.
- The Google Pay flow end to end.
- The signature-verification logic, using self-generated keys. Genuine tokens pass and tampered or forged ones are rejected.
- The dashboard as Owner and as a rep.
- The client build.

Not tested yet:
- Real Telegram API calls. Only a placeholder token was used.
- A real Google Pay payment checked against Google's live TEST keys. The fallback is `verification: 'log_only'`.
- Any of this on a deployed site.

## Blocked right now: deployment
- There is no live URL yet.
- The Supabase project `leadguard-hackathon` (`mvroynhilcyphpqxzzfb`, ap-south-1) is healthy but **empty**. It has no tables and no demo data.
- My attempt to apply the schema through the Supabase tool was cancelled, so nothing was created.
- That is not a blocker for deployment. The server creates all tables itself on first boot.
- Vercel project creation was refused for my account, so someone with Vercel access has to import the repo.

How to deploy:
1. In Vercel, import the repo with the "Other" framework preset.
2. Set these variables: `DATABASE_URL`, `JWT_SECRET`, `APP_ENC_KEY`, `NODE_ENV=production`, `PUBLIC_URL`, and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` if Google Calendar is wanted.
3. Get `DATABASE_URL` from Supabase: Project → Connect → Transaction pooler, and copy the URI. The password is in the dashboard, or reset it under Project Settings → Database. If the connection fails, swap `aws-1` for `aws-0` in the host.
4. Generate `JWT_SECRET` and `APP_ENC_KEY` with `openssl rand -hex 32`.
5. Deploy once. Set `PUBLIC_URL` to the real `https://...vercel.app` address and redeploy.
6. Check `/api/v1/ping`.

Known trade-off: Vercel has no always-on process. The escalation ticker runs on incoming requests and on the 3-second client polling. That is fine for a demo, but it is not a true background worker.

## Left on Musa's plate, in order
1. **Get the live URL**, then seed the demo data into Supabase. Direct database access from my environment was blocked, so seeding needs one of:
   - running `node server/db/seed.js` from any machine with `DATABASE_URL` set, or
   - me generating SQL and applying it through Supabase, once that tool is allowed.
2. **Run the isolation test against the deployed site:** `BASE=https://<url> bash server/scripts/isolation-test.sh`. Also re-run it locally first.
3. **Telegram on the live site:**
   - Paste the bot token on the Integrations page, which registers the webhook.
   - Message the bot from a phone that is not an employee.
   - Check the new contact and lead, reply from the Inbox, replay an update (no duplicate), send without the secret (rejected and logged), and `/stop`.
4. **One real Google Pay payment** in Chrome signed into a Google account. If Google's live TEST keys reject the token, either fix verification or leave `log_only` and say so honestly in the self-check.
5. **Google Pay checks:** confirm the 30-minute expiry, the refund and partial refund, and that the dashboard "collected" figure rises.
6. **Remove Railway leftovers** (`railway.json`, CLAUDE.md text). Add Vercel and Supabase deploy notes with no secrets.
7. **Rubric polish:**
   - Mobile (375px) checks on my pages.
   - Clear error text everywhere.
   - No secrets in code.
   - Provider-failure isolation.
8. **Final reseed** and one demo rehearsal in the CLAUDE.md §15 order, plus the honest self-check list (what is real, what is `log_only`, what is limited).

## Notes for whoever continues
- Commit prefix is `[musa]`. Run `git pull --rebase` before pushing.
- `npm run build` in `client/` must pass before every push.
- Do not commit `.env` or any keys.
- Local dev needs Postgres running (`service postgresql start`) and `server/.env` with `DATABASE_URL`, `JWT_SECRET`, `PUBLIC_URL`.

## Update 14:35: database and cleanup
- Supabase project `mvroynhilcyphpqxzzfb` is the only database now. Railway is dropped, `railway.json` is deleted, and the Railway wording in `.env.example` and code comments is replaced.
- Isolation test re-run locally after the latest pushes: **20/20 pass**.
- **Seeding Supabase:** my cloud container cannot reach the Supabase host (DNS fails), so I could not seed it myself. Any laptop can do it with one command, after the first deploy has created the tables (or even before, because the seed runs the schema too):

  ```
  cd server
  DATABASE_URL='<supabase pooler uri>' node db/seed.js --reset
  ```

  Never commit the URI. Rotate the database password at the end.
