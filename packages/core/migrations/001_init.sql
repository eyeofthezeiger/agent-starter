-- Phase 0 foundations: inbox, gate, retry queue, outbox, audit log, pause switch, briefs.
-- Postgres is the source of truth. The messenger bus only ever gets copies.

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES ('paused', 'false'::jsonb);

-- Gate: members of the allowed Slack user group, synced by the Slack app.
CREATE TABLE gate_members (
  slack_user_id text PRIMARY KEY,
  synced_at     timestamptz NOT NULL DEFAULT now()
);

-- Gate: per-source trust. explicit = asked directly, inferred = observe only, ignore = drop.
CREATE TABLE source_trust (
  source text PRIMARY KEY,
  trust  text NOT NULL CHECK (trust IN ('explicit', 'inferred', 'ignore'))
);

INSERT INTO source_trust (source, trust) VALUES
  ('slack_command',  'explicit'),
  ('slack_shortcut', 'explicit'),
  ('slack_dm',       'explicit'),
  ('slack_mention',  'explicit'),
  ('chrome',         'explicit'),
  ('slack_ambient',  'inferred'),
  ('notes',          'ignore'),
  ('seed',           'explicit');

-- Inbox: one record per source message, stored once by id so retries never duplicate.
CREATE TABLE inbox_items (
  id              text PRIMARY KEY,               -- "<source>:<native id>"
  source          text NOT NULL,
  lane            text NOT NULL DEFAULT 'work' CHECK (lane IN ('work', 'personal')),
  author          text NOT NULL,
  addressed       boolean NOT NULL DEFAULT false,
  link_back       text,
  raw_text        text,                           -- NULL for rejected records: keep metadata, not content
  refs            text[] NOT NULL DEFAULT '{}',
  source_ts       timestamptz,
  thread_key      text,
  gate_decision   text NOT NULL CHECK (gate_decision IN ('admit', 'observe', 'reject')),
  gate_reason     text NOT NULL,
  status          text NOT NULL DEFAULT 'new',
  category        text,
  urgency         text,
  confidence      real,
  reason          text,
  proposed_action jsonb,
  jira_key        text,
  decided_by      text,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inbox_items_status_idx ON inbox_items (status, created_at DESC);

-- Retry queue for internal work (triage, sweeps, digests, retention).
CREATE TABLE jobs (
  id           bigserial PRIMARY KEY,
  type         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'dead')),
  attempts     int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  run_at       timestamptz NOT NULL DEFAULT now(),
  locked_at    timestamptz,
  last_error   text,
  dedupe_key   text UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

CREATE INDEX jobs_due_idx ON jobs (run_at) WHERE status = 'queued';

-- Outbox: every outgoing write is stored first, then sent with retry and backoff.
CREATE TABLE outbox (
  id              bigserial PRIMARY KEY,
  channel         text NOT NULL,                  -- slack | jira | bus
  action          text NOT NULL,                  -- e.g. slack.post_message, jira.create_issue
  payload         jsonb NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'dead')),
  attempts        int NOT NULL DEFAULT 0,
  max_attempts    int NOT NULL DEFAULT 8,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  result          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);

CREATE INDEX outbox_due_idx ON outbox (next_attempt_at) WHERE status = 'pending';

-- Briefs: morning digests, inferred-item digests, meeting briefs.
CREATE TABLE briefs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Audit log: append-only. Records what each run read, decided and did, and who decided.
CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor        text NOT NULL,                     -- a Slack user id, "system", or "triage:<impl>"
  action       text NOT NULL,
  subject_type text,
  subject_id   text,
  details      jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

-- Rows can never be edited. Deletes are only allowed inside the retention job,
-- which sets cos.retention = 'on' for its own transaction.
CREATE FUNCTION audit_log_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('cos.retention', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
