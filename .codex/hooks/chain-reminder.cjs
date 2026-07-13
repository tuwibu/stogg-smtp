#!/usr/bin/env node
/**
 * chain-reminder.cjs — Generic workflow-chain reminder (SubagentStop)
 *
 * Fires on every subagent stop. Maps agent_type → skill name, checks if the
 * skill is a key in workflow.chains, and emits a soft reminder to the LLM
 * orchestrator to fire AskUserQuestion with next-step options.
 *
 * This is a SOFT reminder only — it never blocks and never changes exit codes.
 * The actual obligation to fire AskUserQuestion lives in workflow-chaining.md.
 *
 * Replaces cook-after-plan-reminder.cjs (gộp logic cũ, tránh 2 hook trùng).
 * The plan-skill output is backward-compatible with advisory-boundary-policy tests.
 *
 * Exit codes: always 0 (fail-open, non-blocking).
 */

'use strict';

try {
  const fs = require('fs');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const { isHookEnabled, loadConfig, readSessionState } = require('./lib/ck-config-utils.cjs');

  // Hook can be disabled via .ck.json hooks.chain-reminder = false
  if (!isHookEnabled('chain-reminder')) process.exit(0);

  // ---------------------------------------------------------------------------
  // agent_type → skill name map
  // Matches Claude Code subagent names (case-insensitive) to workflow skill keys.
  // Add new entries here as skills are added to workflow.chains.
  // ---------------------------------------------------------------------------
  const AGENT_TO_SKILL = {
    plan:        'plan',
    planner:     'plan',
    planning:    'plan',
    cook:        'cook',
    cooker:      'cook',
    cooking:     'cook',
    brainstorm:  'brainstorm',
    brainstormer:'brainstorm',
    debug:       'debug',
    debugger:    'debug',
    fix:         'fix',
    fixer:       'fix',
    test:        'test',
    tester:      'test',
    simplify:    'simplify',
    simplifier:  'simplify',
    docs:        'docs',
    docsmanager: 'docs',
    review:      'review',
    reviewer:    'review',
  };

  async function main() {
    try {
      const stdin = fs.readFileSync(0, 'utf-8').trim();
      if (!stdin) process.exit(0);

      let input;
      try { input = JSON.parse(stdin); } catch (_) { process.exit(0); }

      // Resolve skill from agent_type
      const agentTypeRaw = (input.agent_type || '').toLowerCase().replace(/[^a-z]/g, '');
      const skill = AGENT_TO_SKILL[agentTypeRaw];
      if (!skill) process.exit(0); // unknown agent → silent

      const config = loadConfig({ includeProject: false, includeAssertions: false, includeLocale: false });
      const chains = config?.workflow?.chains || {};

      // Not a chain key → terminal skill, no reminder needed
      if (!chains[skill]) process.exit(0);

      // ---------------------------------------------------------------------------
      // Filter remaining chain (basic gates — mirrors workflow-chaining.md logic)
      // ---------------------------------------------------------------------------
      let remaining = [...chains[skill]];

      // Gate: bỏ test nếu hasTests !== true
      if (config?.workflow?.hasTests !== true) {
        remaining = remaining.filter(s => s !== 'test');
      }

      // Gate: bỏ git nếu không có .git ở root
      const projectRoot = process.cwd();
      if (!fs.existsSync(path.join(projectRoot, '.git'))) {
        remaining = remaining.filter(s => s !== 'git');
      }

      if (remaining.length === 0) process.exit(0); // chain empty after filter

      // ---------------------------------------------------------------------------
      // Special gate for cook: CHỈ nhắc khi isComplete === true
      // Prevents mid-plan reminder noise between phases.
      // ---------------------------------------------------------------------------
      if (skill === 'cook') {
        const activePlanDir = process.env.CK_ACTIVE_PLAN || (() => {
          const sessionId = process.env.CK_SESSION_ID;
          if (!sessionId) return null;
          const state = readSessionState(sessionId);
          return state?.activePlan || null;
        })();

        if (activePlanDir) {
          try {
            const out = execFileSync(process.execPath, [
              path.join(__dirname, 'cook-state.cjs'),
              'check',
              activePlanDir
            ], { encoding: 'utf8', timeout: 3000 });
            const cookState = JSON.parse(out.trim());
            if (cookState.isComplete === false) process.exit(0); // still in-progress → silent
          } catch (_) {
            // cook-state unavailable or corrupt → fail-open, show reminder
          }
        }
      }

      // ---------------------------------------------------------------------------
      // Emit reminder
      // ---------------------------------------------------------------------------
      const chainStr = remaining.join(' → ');

      if (skill === 'plan') {
        // Backward-compatible output for advisory-boundary-policy tests.
        // Must match: /Planning complete/i, /implement/i, /validate/i, /red-team/i
        // Must NOT match: /\/cook\s+--auto/i
        console.log('Planning complete. Stop here and ask the user which next step they want: implement, validate, red-team, revise, or end.');

        // Include plan path for new-session discoverability
        const sessionId = process.env.CK_SESSION_ID;
        let planPath = null;
        if (sessionId) {
          const state = readSessionState(sessionId);
          if (state?.activePlan) {
            planPath = state.activePlan;
            if (!path.isAbsolute(planPath) && state.sessionOrigin) {
              planPath = path.resolve(state.sessionOrigin, planPath);
            }
          }
        }
        if (planPath) {
          console.log(`Optional implementation command after user approval: /cook ${path.join(planPath, 'plan.md')}`);
        } else {
          console.log('Optional implementation command after user approval: /cook {full-absolute-path-to-plan.md}');
        }
        console.log('Add --auto only if the user explicitly asks for autonomous implementation.');
        console.log(`[chain-reminder] ${skill} done — chain: ${chainStr}. Fire AskUserQuestion with next-step options.`);
      } else {
        // Generic reminder for all other chain-key skills
        console.log(`[chain-reminder] ${skill} done — chain remaining: ${chainStr}. Fire AskUserQuestion with next-step options per workflow-chaining.md.`);
      }

      process.exit(0);
    } catch (_) {
      process.exit(0); // silent fail
    }
  }

  main();
} catch (e) {
  // Minimal crash log — zero deps
  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'chain-reminder', status: 'crash', error: e && e.message }) + '\n'
    );
  } catch (_) {}
  process.exit(0);
}
