-- Read-only Postgres role for the Grafana Postgres datasource.
-- Grants SELECT ONLY on rollup/observability tables — deliberately NOT the whole
-- schema, so Grafana can never read users/profiles/API keys/secrets.
--
-- Usage (run once as superuser):
--   psql -d <your_database> -f create-grafana-readonly-user.sql
--
-- After running, set GRAFANA_PG_PASSWORD in .env to the password chosen below.
-- The datasource config (grafana/provisioning/datasources/postgres.yaml) connects
-- as this role automatically.

-- CHANGE_ME: replace 'a-strong-random-password' with a real password.
-- Generate one with: openssl rand -hex 24
CREATE ROLE grafana_ro LOGIN PASSWORD 'CHANGE_ME';

-- CHANGE_ME: replace 'your_database' with the actual database name.
GRANT CONNECT ON DATABASE your_database TO grafana_ro;
GRANT USAGE ON SCHEMA public TO grafana_ro;

-- Grant SELECT on the tables Grafana dashboards need.
-- CHANGE_ME: replace/extend this list with the actual rollup/aggregation tables
-- in your schema. Do NOT add application tables (users, sessions, api_keys, etc.).
-- Example tables shown below — adapt to your project:
GRANT SELECT ON
  -- add your rollup / aggregation / observability tables here, e.g.:
  -- rollup_hourly,
  -- rollup_daily,
  -- fleet_snapshot,
  -- alert_state
TO grafana_ro;

-- Verification (should SUCCEED — returns rows):
--   SET ROLE grafana_ro; SELECT current_user;
--
-- Verification (should FAIL with permission denied):
--   SET ROLE grafana_ro; SELECT * FROM users LIMIT 1;
