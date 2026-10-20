-- FZA Instagram Monitor — esquema inicial.
-- Todos os horários são timestamptz (armazenados em UTC).

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext NOT NULL UNIQUE,
  name               text NOT NULL,
  password_hash      text NOT NULL,
  role               text NOT NULL CHECK (role IN ('admin', 'analyst', 'viewer')),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Sessões: guarda apenas o SHA-256 do token; o token em si fica só no cookie.
CREATE TABLE sessions (
  id           text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- ---------------------------------------------------------------- clients
CREATE TABLE clients (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                       text NOT NULL,
  category                   text,
  notes                      text,
  status                     text NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'paused', 'archived')),
  -- Metas e limites (NULL = usa o padrão das configurações)
  posting_goal_per_week      numeric(6,2) CHECK (posting_goal_per_week IS NULL OR posting_goal_per_week >= 0),
  inactivity_alert_days      integer CHECK (inactivity_alert_days IS NULL OR inactivity_alert_days > 0),
  negative_change_threshold  integer CHECK (negative_change_threshold IS NULL OR negative_change_threshold > 0),
  growth_goal_pct_30d        numeric(6,2),
  archived_at                timestamptz,
  purge_after                timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clients_status_idx ON clients (status);

-- ---------------------------------------------------------------- instagram_profiles
CREATE TABLE instagram_profiles (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  username                citext NOT NULL,
  canonical_url           text,
  external_id             text,
  full_name               text,
  profile_picture_url     text,
  -- pending: ainda sem coleta; ok; not_found_or_personal; private; unavailable; error
  profile_state           text NOT NULL DEFAULT 'pending'
                            CHECK (profile_state IN ('pending', 'ok', 'not_found_or_personal',
                                                     'private', 'unavailable', 'error')),
  state_reason            text,
  source                  text,
  -- Agendamento
  next_collection_at      timestamptz DEFAULT now(),
  manual_requested_at     timestamptz,
  lease_owner             text,
  lease_until             timestamptz,
  last_attempt_at         timestamptz,
  last_success_at         timestamptz,
  last_media_success_at   timestamptz,
  -- Desde quando o sistema tem certeza de ter visto todas as publicações (ver core/posting.ts).
  media_coverage_start    timestamptz,
  consecutive_failures    integer NOT NULL DEFAULT 0,
  permanent_failures      integer NOT NULL DEFAULT 0,
  last_error_code         text,
  last_error_message      text,
  -- Último valor válido (desnormalizado para leitura rápida; a verdade está em follower_snapshots)
  current_followers       integer,
  current_follows         integer,
  current_media_count     integer,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instagram_profiles_username_unique UNIQUE (username),
  CONSTRAINT username_format CHECK (username ~ '^[a-z0-9._]{1,30}$')
);
CREATE INDEX profiles_client_idx ON instagram_profiles (client_id);
CREATE INDEX profiles_due_idx ON instagram_profiles (next_collection_at);
CREATE UNIQUE INDEX profiles_external_id_unique ON instagram_profiles (external_id)
  WHERE external_id IS NOT NULL;

-- ---------------------------------------------------------------- collection_runs
CREATE TABLE collection_runs (
  id                bigserial PRIMARY KEY,
  profile_id        uuid NOT NULL REFERENCES instagram_profiles(id) ON DELETE CASCADE,
  source            text NOT NULL,
  trigger           text NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
  worker_id         text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  status            text NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running', 'success', 'partial', 'failed', 'abandoned')),
  error_code        text,
  error_message     text,
  attempt           integer NOT NULL DEFAULT 1,
  records_processed integer NOT NULL DEFAULT 0,
  media_new         integer NOT NULL DEFAULT 0,
  media_requested   boolean NOT NULL DEFAULT false,
  duration_ms       integer
);
CREATE INDEX runs_profile_started_idx ON collection_runs (profile_id, started_at DESC);
CREATE INDEX runs_started_idx ON collection_runs (started_at DESC);
CREATE INDEX runs_status_idx ON collection_runs (status);

-- ---------------------------------------------------------------- follower_snapshots
-- Imutável: um registro por observação bem-sucedida. Nunca é atualizado.
CREATE TABLE follower_snapshots (
  id               bigserial PRIMARY KEY,
  profile_id       uuid NOT NULL REFERENCES instagram_profiles(id) ON DELETE CASCADE,
  followers_count  integer CHECK (followers_count IS NULL OR followers_count >= 0),
  follows_count    integer CHECK (follows_count IS NULL OR follows_count >= 0),
  media_count      integer CHECK (media_count IS NULL OR media_count >= 0),
  observed_at      timestamptz NOT NULL,
  collected_at     timestamptz NOT NULL DEFAULT now(),
  source           text NOT NULL,
  validity         text NOT NULL DEFAULT 'valid' CHECK (validity IN ('valid', 'suspect')),
  validity_reason  text,
  run_id           bigint REFERENCES collection_runs(id) ON DELETE SET NULL
);
CREATE INDEX snapshots_profile_observed_idx ON follower_snapshots (profile_id, observed_at DESC);

CREATE FUNCTION forbid_snapshot_update() RETURNS trigger AS $$
BEGIN
  -- ON DELETE SET NULL de run_id é a única alteração permitida.
  IF NEW.run_id IS NULL AND OLD.run_id IS NOT NULL
     AND NEW.followers_count IS NOT DISTINCT FROM OLD.followers_count
     AND NEW.follows_count IS NOT DISTINCT FROM OLD.follows_count
     AND NEW.media_count IS NOT DISTINCT FROM OLD.media_count
     AND NEW.observed_at = OLD.observed_at AND NEW.source = OLD.source
     AND NEW.validity = OLD.validity THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'follower_snapshots é imutável';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER follower_snapshots_immutable BEFORE UPDATE ON follower_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_snapshot_update();

-- ---------------------------------------------------------------- media_items
CREATE TABLE media_items (
  id               bigserial PRIMARY KEY,
  profile_id       uuid NOT NULL REFERENCES instagram_profiles(id) ON DELETE CASCADE,
  external_id      text,
  -- dedupe_key = external_id quando existe; senão 'permalink:<url>' (ver docs/PROVEDOR-META.md)
  dedupe_key       text NOT NULL,
  permalink        text,
  media_type       text NOT NULL CHECK (media_type IN ('image', 'carousel', 'video', 'reel', 'unknown')),
  source_media_type text,
  published_at     timestamptz,
  caption          text,
  thumbnail_url    text,
  like_count       integer,
  comments_count   integer,
  source           text NOT NULL,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_dedupe_unique UNIQUE (profile_id, dedupe_key)
);
CREATE INDEX media_profile_published_idx ON media_items (profile_id, published_at DESC);

-- ---------------------------------------------------------------- alerts
CREATE TABLE alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        uuid NOT NULL REFERENCES instagram_profiles(id) ON DELETE CASCADE,
  type              text NOT NULL CHECK (type IN ('no_posts', 'negative_change', 'low_growth',
                                                  'posting_below_goal', 'collection_failing',
                                                  'stale_data', 'profile_unavailable')),
  category          text NOT NULL CHECK (category IN ('profile', 'collector')),
  severity          text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  title             text NOT NULL,
  message           text NOT NULL,
  details           jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurrences       integer NOT NULL DEFAULT 1,
  reopened_from     uuid REFERENCES alerts(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_triggered_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at   timestamptz,
  acknowledged_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at       timestamptz,
  resolved_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  resolution        text CHECK (resolution IN ('auto', 'manual')),
  silenced_until    timestamptz
);
-- Deduplicação: no máximo um alerta ativo por perfil e tipo.
CREATE UNIQUE INDEX alerts_active_unique ON alerts (profile_id, type)
  WHERE status IN ('open', 'acknowledged');
CREATE INDEX alerts_status_idx ON alerts (status, created_at DESC);

-- ---------------------------------------------------------------- settings
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------- provider_state
-- Pausa global por fonte (ex.: limite de requisições atingido, token inválido).
CREATE TABLE provider_state (
  provider     text PRIMARY KEY,
  paused_until timestamptz,
  reason       text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- worker_heartbeats
CREATE TABLE worker_heartbeats (
  worker_id         text PRIMARY KEY,
  started_at        timestamptz NOT NULL,
  last_heartbeat_at timestamptz NOT NULL,
  version           text,
  info              jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------- audit_log
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_created_idx ON audit_log (created_at DESC);
