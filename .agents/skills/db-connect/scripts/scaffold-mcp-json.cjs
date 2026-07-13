#!/usr/bin/env node
/**
 * scaffold-mcp-json.cjs — Generate / merge an MCP server entry into .mcp.json.
 *
 * CLI: node scaffold-mcp-json.cjs <datastore> <server-name> --env <env-file> [--out <.mcp.json>]
 *
 * Datastores: postgres | redis | clickhouse | s3
 *
 * Security rule (finding 6): reads env file for variable NAMES only. Writes
 * "${VAR_NAME}" env-ref placeholders — never actual secret values.
 *
 * Merge: preserves existing mcpServers entries; adds/replaces only <server-name>.
 * Gitignore: ensures output dir's .gitignore contains ".mcp.json".
 *
 * Exit 0 = success; 1 = bad args / unknown datastore / missing env file.
 *
 * Contract: plans/.../phase-04-dev-connector-env-guard.md §2 mapping table.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { BUILDERS } = require('./mcp-server-builders.cjs');

// ─── CLI parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  let i = 0;
  while (i < argv.length) {
    if (argv[i] === '--env' && argv[i + 1]) { opts.env = argv[++i]; }
    else if (argv[i] === '--out' && argv[i + 1]) { opts.out = argv[++i]; }
    else if (!argv[i].startsWith('--')) { positional.push(argv[i]); }
    i++;
  }
  return { positional, opts };
}

const { positional, opts } = parseArgs(process.argv.slice(2));
const [datastore, serverName] = positional;

function die(msg) {
  process.stderr.write(`[scaffold-mcp-json] ERROR: ${msg}\n`);
  process.exit(1);
}

if (!datastore || !serverName) {
  die('Usage: scaffold-mcp-json.cjs <datastore> <server-name> --env <env-file> [--out <.mcp.json>]');
}
if (!opts.env) die('--env <env-file> is required');
if (!BUILDERS[datastore]) {
  die(`Unknown datastore "${datastore}". Supported: ${Object.keys(BUILDERS).join(', ')}`);
}

// ─── Env file: parse names only (never use values in output) ─────────────────

function parseEnvNames(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch (err) { die(`Cannot read env file "${filePath}": ${err.message}`); }

  const names = new Set();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) names.add(trimmed.slice(0, eqIdx).trim());
  }
  return names;
}

const envNames = parseEnvNames(opts.env);

// ─── Load / merge / write .mcp.json ──────────────────────────────────────────

const outFile = opts.out || path.join(process.cwd(), '.mcp.json');
const outDir = path.dirname(path.resolve(outFile));

let mcpConfig = { mcpServers: {} };
if (fs.existsSync(outFile)) {
  try {
    const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    if (existing && typeof existing === 'object') {
      mcpConfig = existing;
      if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== 'object') {
        mcpConfig.mcpServers = {};
      }
    }
  } catch (_) {
    process.stderr.write('[scaffold-mcp-json] WARN: existing .mcp.json is not valid JSON — overwriting.\n');
    mcpConfig = { mcpServers: {} };
  }
}

mcpConfig.mcpServers[serverName] = BUILDERS[datastore](envNames);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf8');

// ─── Ensure .gitignore contains ".mcp.json" ──────────────────────────────────

const gitignorePath = path.join(outDir, '.gitignore');
let giContent = '';
try { giContent = fs.readFileSync(gitignorePath, 'utf8'); } catch (_) { /* will create */ }

if (!giContent.split('\n').some(l => l.trim() === '.mcp.json')) {
  const append = (giContent.endsWith('\n') || giContent === '') ? '.mcp.json\n' : '\n.mcp.json\n';
  fs.writeFileSync(gitignorePath, giContent + append, 'utf8');
}

process.stdout.write(`[scaffold-mcp-json] OK: wrote "${serverName}" (${datastore}) → ${outFile}\n`);
process.exit(0);
