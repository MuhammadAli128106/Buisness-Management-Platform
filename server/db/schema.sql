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

-- ── Provider switch (organiser announcement 12:47): Telegram replaces Twilio for messaging (I1),
--    Google Pay (TEST environment) replaces Stripe for payments (I2). Idempotent migrations.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS telegram_chat_id text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS telegram_username text;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_ws_tg ON contacts(workspace_id, telegram_chat_id) WHERE telegram_chat_id IS NOT NULL AND deleted_at IS NULL;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check CHECK (source IN ('web_form','whatsapp','telegram','manual'));
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_provider_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_provider_check CHECK (provider IN ('twilio','stripe','telegram','google','googlepay'));
ALTER TABLE conversations ALTER COLUMN channel SET DEFAULT 'telegram';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS messages_ws_external ON messages(workspace_id, external_id) WHERE external_id IS NOT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'googlepay';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS link_token text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_ref text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS payments_link_token ON payments(link_token) WHERE link_token IS NOT NULL;
