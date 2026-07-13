'use strict';
/**
 * mcp-server-builders.cjs — MCP server entry builders for each supported datastore.
 *
 * Each builder receives the Set of env-var NAMES found in .env.dev and returns an
 * MCP server entry object using "${VAR_NAME}" env-ref placeholders. Actual secret
 * values are NEVER passed to or stored by these builders (finding 6).
 *
 * Mapping table (spec §2):
 *   postgres   → npx @modelcontextprotocol/server-postgres, env-ref DATABASE_URL, read-only.
 *   redis      → uvx redis-mcp, env-refs REDIS_HOST/PORT/PWD (REDIS_PASSWORD → REDIS_PWD).
 *   clickhouse → uvx mcp-clickhouse, env-refs from CLICKHOUSE_URL or individual vars.
 *   s3         → npx aws-s3-mcp, env-refs S3_ENDPOINT/ACCESS_KEY_ID/SECRET, S3_REGION=auto.
 */

/** Return "${VAR_NAME}" placeholder — never the actual value. */
function ref(varName) {
  return `\${${varName}}`;
}

function buildPostgresEntry(envNames) {
  const env = {};
  if (envNames.has('DATABASE_URL')) env.DATABASE_URL = ref('DATABASE_URL');
  return {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', '--read-only', ref('DATABASE_URL')],
    env,
  };
}

function buildRedisEntry(envNames) {
  const env = {};
  if (envNames.has('REDIS_HOST')) env.REDIS_HOST = ref('REDIS_HOST');
  if (envNames.has('REDIS_PORT')) env.REDIS_PORT = ref('REDIS_PORT');
  // REDIS_PASSWORD in .env.dev → REDIS_PWD key in MCP config (spec §2 mapping).
  // The ref MUST point at the var that actually exists at runtime, not the renamed key.
  if (envNames.has('REDIS_PASSWORD')) env.REDIS_PWD = ref('REDIS_PASSWORD');
  else if (envNames.has('REDIS_PWD')) env.REDIS_PWD = ref('REDIS_PWD');
  return {
    command: 'uvx',
    args: ['redis-mcp'],
    env,
  };
}

function buildClickhouseEntry(envNames) {
  const env = {};
  // Emit the URL ref when present, plus only the component refs that actually exist
  // in .env.dev — phantom refs to unset vars would override the URL with empty values.
  if (envNames.has('CLICKHOUSE_URL')) env.CLICKHOUSE_URL = ref('CLICKHOUSE_URL');
  if (envNames.has('CLICKHOUSE_HOST')) env.CLICKHOUSE_HOST = ref('CLICKHOUSE_HOST');
  if (envNames.has('CLICKHOUSE_PORT')) env.CLICKHOUSE_PORT = ref('CLICKHOUSE_PORT');
  if (envNames.has('CLICKHOUSE_USER')) env.CLICKHOUSE_USER = ref('CLICKHOUSE_USER');
  if (envNames.has('CLICKHOUSE_DB')) env.CLICKHOUSE_DB = ref('CLICKHOUSE_DB');
  return {
    command: 'uvx',
    args: ['mcp-clickhouse'],
    env,
  };
}

function buildS3Entry(envNames) {
  // S3_REGION=auto is a convention (not a secret), hardcoded per Cloudflare R2 spec.
  const env = { S3_REGION: 'auto' };
  if (envNames.has('S3_ENDPOINT')) env.S3_ENDPOINT = ref('S3_ENDPOINT');
  if (envNames.has('S3_ACCESS_KEY_ID')) env.S3_ACCESS_KEY_ID = ref('S3_ACCESS_KEY_ID');
  if (envNames.has('S3_SECRET_ACCESS_KEY')) env.S3_SECRET_ACCESS_KEY = ref('S3_SECRET_ACCESS_KEY');
  return {
    command: 'npx',
    args: ['-y', 'aws-s3-mcp'],
    env,
  };
}

const BUILDERS = {
  postgres: buildPostgresEntry,
  redis: buildRedisEntry,
  clickhouse: buildClickhouseEntry,
  s3: buildS3Entry,
};

module.exports = { BUILDERS };
