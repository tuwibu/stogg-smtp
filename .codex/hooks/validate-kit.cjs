#!/usr/bin/env node
/**
 * validate-kit.cjs — ClaudeKit integrity checker (manual / CI only, not a lifecycle hook)
 *
 * Checks:
 *   1. Chain refs      — every skill in workflow.chains (keys + values) has a skills/ dir
 *   2. Hook wiring     — every *.cjs referenced in hooks.json exists on disk
 *   3. Rule cross-refs — relative markdown links ](./<file>.md) in rules/*.md point to existing files
 *   4. Agent frontmatter — each agents/*.md has name, model, tools
 *   5. skipBlockers    — every entry in workflow.skipBlockers is an existing skill
 *
 * Exit 0 = kit valid. Exit 1 = drift found (errors printed to stdout).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Bootstrap: resolve kit root (parent of .codex/)
// ---------------------------------------------------------------------------
const HOOKS_DIR  = __dirname;                          // .codex/hooks/
const CODEX_DIR = path.dirname(HOOKS_DIR);            // .codex/
const KIT_ROOT   = path.dirname(CODEX_DIR);           // project root

// ---------------------------------------------------------------------------
// Reuse ck-config-utils to load workflow config (REUSE-AS-IS per audit)
// ---------------------------------------------------------------------------
const { loadConfig } = require('./lib/ck-config-utils.cjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** List skill names that have a SKILL.md inside .agents/skills/ */
function listSkills() {
  const skillsDir = path.join(KIT_ROOT, '.agents', 'skills');
  if (!fs.existsSync(skillsDir)) return new Set();
  return new Set(
    fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && fs.existsSync(path.join(skillsDir, e.name, 'SKILL.md')))
      .map(e => e.name)
  );
}

/** Parse minimal frontmatter (key: value lines) from markdown string */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const val = line.slice(sep + 1).trim();
    if (key) fm[key] = val;
  }
  return fm;
}

/** Collect all .cjs paths referenced in hooks.json commands */
function extractHookPathsFromSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return [];
  const raw = fs.readFileSync(settingsPath, 'utf8');
  const paths = [];
  // Match: node "path.cjs" refs in hooks.json
  const re = /node\s+"([^"]+\.cjs)"/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

/** Collect relative rule cross-ref targets from a rules file */
function extractRuleRefs(content) {
  const refs = [];
  // Match ](./some-file.md) or ](./path/to/file.md)
  const re = /\]\(\.\/([\w/.-]+\.md)\)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    refs.push(m[1]);
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const issues = [];

function fail(check, detail) {
  issues.push(`[FAIL] ${check}: ${detail}`);
}

// 1. Chain refs ----------------------------------------------------------
function checkChainRefs(config, skills) {
  const chains = config?.workflow?.chains;
  if (!chains || typeof chains !== 'object') {
    fail('chain-refs', 'workflow.chains missing from config');
    return;
  }
  const seen = new Set();
  for (const [key, values] of Object.entries(chains)) {
    if (!seen.has(key)) {
      seen.add(key);
      if (!skills.has(key)) {
        fail('chain-refs', `chain key "${key}" has no skills/${key}/SKILL.md`);
      }
    }
    if (!Array.isArray(values)) continue;
    for (const skill of values) {
      if (!seen.has(skill)) {
        seen.add(skill);
        if (!skills.has(skill)) {
          fail('chain-refs', `chain value "${skill}" has no skills/${skill}/SKILL.md`);
        }
      }
    }
  }
}

// 2. Hook wiring ---------------------------------------------------------
function checkHookWiring() {
  const settingsPath = path.join(CODEX_DIR, 'hooks.json');
  const refs = extractHookPathsFromSettings(settingsPath);
  for (const ref of refs) {
    // ref is relative to KIT_ROOT (e.g. ".codex/hooks/session-init.cjs")
    const abs = path.join(KIT_ROOT, ref);
    if (!fs.existsSync(abs)) {
      fail('hook-wiring', `settings.json references missing file: ${ref}`);
    }
  }
}

// 3. Rule cross-refs -----------------------------------------------------
function checkRuleCrossRefs() {
  const rulesDir = path.join(CODEX_DIR, 'rules');
  if (!fs.existsSync(rulesDir)) return;
  const ruleFiles = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md'));
  for (const ruleFile of ruleFiles) {
    const content = fs.readFileSync(path.join(rulesDir, ruleFile), 'utf8');
    const refs = extractRuleRefs(content);
    for (const ref of refs) {
      // ref is relative to the rules/ dir (e.g. "workflow-chaining.md")
      // Only check files that stay within rules/ (no subdirectory traversal outside)
      const targetAbs = path.join(rulesDir, ref);
      if (!fs.existsSync(targetAbs)) {
        fail('rule-cross-refs', `${ruleFile} links to missing rules/${ref}`);
      }
    }
  }
}

// 4. Agent frontmatter ---------------------------------------------------
function checkAgentFrontmatter() {
  const agentsDir = path.join(CODEX_DIR, 'agents');
  if (!fs.existsSync(agentsDir)) return;
  const agentFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
  const required = ['name', 'model', 'tools'];
  for (const file of agentFiles) {
    const content = fs.readFileSync(path.join(agentsDir, file), 'utf8');
    const fm = parseFrontmatter(content);
    if (!fm) {
      fail('agent-frontmatter', `${file}: no YAML frontmatter found`);
      continue;
    }
    for (const field of required) {
      if (!fm[field] || fm[field] === '') {
        fail('agent-frontmatter', `${file}: missing or empty "${field}"`);
      }
    }
  }
}

// 5. skipBlockers --------------------------------------------------------
function checkSkipBlockers(config, skills) {
  const blockers = config?.workflow?.skipBlockers;
  if (!Array.isArray(blockers)) return;
  for (const skill of blockers) {
    if (!skills.has(skill)) {
      fail('skip-blockers', `skipBlockers entry "${skill}" has no skills/${skill}/SKILL.md`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const config = loadConfig({ includeProject: false, includeAssertions: false });
const skills = listSkills();

checkChainRefs(config, skills);
checkHookWiring();
checkRuleCrossRefs();
checkAgentFrontmatter();
checkSkipBlockers(config, skills);

if (issues.length === 0) {
  console.log('[OK] kit valid');
  process.exit(0);
} else {
  for (const issue of issues) {
    console.log(issue);
  }
  console.log(`[FAIL] ${issues.length} issue${issues.length > 1 ? 's' : ''}`);
  process.exit(1);
}
