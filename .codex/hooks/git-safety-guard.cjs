#!/usr/bin/env node
// PreToolUse hook on Bash. Blocks destructive git operations that can destroy history.
// Allows: add, commit, push (normal), pull, fetch, status, log, diff, checkout <branch>, restore <file>.
// Blocks: reset --hard, push --force/-f (not --force-with-lease), clean -f, checkout -- ., restore ., branch -D.
// Warns (does not block): commit --amend.

let payload = '';
process.stdin.on('data', c => payload += c);
process.stdin.on('end', () => {
  let data;
  try { data = JSON.parse(payload || '{}'); } catch { process.exit(0); }

  const block = (reason, hint) => {
    process.stderr.write(
      `[git-safety-guard] BLOCKED: ${reason}\n` +
      `  Safer alternative: ${hint}\n` +
      `  Override: run this command manually in your terminal outside Codex, or disable this hook in .codex/hooks.json.\n`
    );
    process.exit(2);
  };

  const warn = (reason, hint) => {
    process.stderr.write(
      `[git-safety-guard] WARNING: ${reason}\n` +
      `  Note: ${hint}\n`
    );
    // exit 0 — allow the command to proceed
  };

  const cmd = (data?.tool_input?.command || '').toString();
  if (!cmd) process.exit(0);

  // Only inspect lines that contain a git invocation.
  // Split multi-command strings (&&, ||, ;) and check each segment.
  const segments = cmd.split(/&&|\|\||;/);

  for (const seg of segments) {
    const s = seg.trim();

    // Must start with git (allowing env vars like GIT_DIR=... git ...)
    if (!/(?:^|\s)git\s/.test(s)) continue;

    // ---- git reset --hard ------------------------------------------------
    // Allow: git reset (soft/mixed), git reset HEAD~1 without --hard
    if (/\bgit\s+reset\b/.test(s) && /--hard\b/.test(s)) {
      block(
        'git reset --hard discards all uncommitted changes permanently',
        'Use `git stash` to save changes temporarily, or `git reset` (without --hard) to unstage only.'
      );
    }

    // ---- git push --force / -f (but NOT --force-with-lease) ---------------
    // --force-with-lease is safe: it checks remote state first.
    if (/\bgit\s+push\b/.test(s)) {
      const hasForce = /\s(-f|--force)\b/.test(s) || /\s-[a-zA-Z]*f[a-zA-Z]*\b/.test(s);
      const hasLease = /--force-with-lease\b/.test(s);
      if (hasForce && !hasLease) {
        block(
          'git push --force rewrites remote history and can destroy teammates\' work',
          'Use `git push --force-with-lease` instead — it only pushes if the remote has not moved since your last fetch.'
        );
      }
    }

    // ---- git clean -f (with optional d/x/X flags) ------------------------
    // git clean requires at least -f; -fd, -fdx, -fx are common destructive variants.
    if (/\bgit\s+clean\b/.test(s) && /\s-[a-zA-Z]*f[a-zA-Z]*\b/.test(s)) {
      block(
        'git clean -f permanently deletes untracked files with no way to recover them',
        'Use `git clean -n` (dry-run) first to see what would be deleted, then confirm manually.'
      );
    }

    // ---- git checkout -- . or git checkout --force -----------------------
    // Specifically target wholesale discard of working tree.
    // Allow: git checkout <branch>, git checkout <file> (specific file)
    if (/\bgit\s+checkout\b/.test(s)) {
      // Block: `-- .` or `-- ./` (discard all). Allow `-- ./path/to/file` (single file).
      if (/\bgit\s+checkout\s+--\s+\.\/?(?:\s|$)/.test(s)) {
        block(
          'git checkout -- . discards ALL uncommitted changes in the working tree',
          'Use `git stash` to save your work, or `git checkout -- <specific-file>` for a single file.'
        );
      }
      // Block: --force flag on checkout (overwrites local changes)
      if (/\bgit\s+checkout\b.*--force\b/.test(s)) {
        block(
          'git checkout --force discards uncommitted changes without warning',
          'Use `git stash` first, then checkout normally.'
        );
      }
    }

    // ---- git restore . (restore entire working tree) ---------------------
    // Allow: git restore <specific-file> or git restore --staged <file>
    if (/\bgit\s+restore\b/.test(s)) {
      // Block restoring entire working tree (`.` or `./`)
      if (/\bgit\s+restore\s+(?:--worktree\s+)?\.(?:\s|$)/.test(s)) {
        block(
          'git restore . discards ALL uncommitted changes in the working tree',
          'Use `git stash` to save your work, or `git restore <specific-file>` for a single file.'
        );
      }
    }

    // ---- git branch -D (force-delete, even unmerged) ---------------------
    // Allow: git branch -d (safe delete — refuses unmerged branches)
    if (/\bgit\s+branch\b/.test(s)) {
      // -D alone, or combined flags containing D (e.g. -Dr)
      if (/\s-[a-zA-Z]*D[a-zA-Z]*\b/.test(s)) {
        block(
          'git branch -D force-deletes a branch even if it has unmerged commits',
          'Use `git branch -d` (lowercase) — it refuses to delete unmerged branches, protecting your work.'
        );
      }
    }

    // ---- git commit --amend (warn only) ----------------------------------
    // Amend is safe on unpushed commits but rewrites history if already pushed.
    // We cannot easily know if the branch is pushed, so warn without blocking.
    if (/\bgit\s+commit\b.*--amend\b/.test(s)) {
      warn(
        'git commit --amend rewrites history — safe only if the commit has NOT been pushed yet',
        'If this commit is already on the remote, use a new commit instead to avoid breaking teammates\' history.'
      );
      // Do not exit(2) — fall through to exit(0) at end
    }
  }

  process.exit(0);
});
