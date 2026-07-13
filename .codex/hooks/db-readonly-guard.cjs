#!/usr/bin/env node
// PreToolUse hook on Bash. Blocks destructive DB operations.
// Allows SELECT, EXPLAIN, ANALYZE, SHOW, DESCRIBE, schema design (file writes via Edit/Write).
// Blocks DDL/DML executed against a live DB (psql/mongosh/mysql/sqlite3 inline SQL)
// and migration runners (prisma migrate, typeorm migration:run, alembic upgrade, etc).

let payload = '';
process.stdin.on('data', c => payload += c);
process.stdin.on('end', () => {
  let data;
  try { data = JSON.parse(payload || '{}'); } catch { process.exit(0); }

  const block = (reason, hint) => {
    process.stderr.write(`[db-readonly-guard] BLOCKED: ${reason}\n  Hint: ${hint}\n  Override: ask the user to run this manually, or disable this hook in .codex/hooks.json.\n`);
    process.exit(2);
  };

  const tool = data?.tool_name || '';
  const filePath = (data?.tool_input?.file_path || '').toString().replace(/\\/g, '/');

  // ---- Write tool: block creating migration files by hand ----
  // Edit/MultiEdit allowed (lets AI tweak CLI-generated file when needed).
  if (tool === 'Write' && filePath) {
    const migrationFilePatterns = [
      { re: /prisma\/migrations\/.+\.(sql|toml)$/i, name: 'Prisma migration' },
      { re: /drizzle\/.+\.sql$/i, name: 'Drizzle migration' },
      { re: /(^|\/)migrations\/\d[\w\-]*\.(sql|js|ts|cjs|mjs)$/i, name: 'TypeORM/Sequelize/Knex migration' },
      { re: /alembic\/versions\/.+\.py$/i, name: 'Alembic migration' },
      { re: /db\/migrate\/\d+_.+\.rb$/i, name: 'Rails migration' },
      { re: /(^|\/)migrations\/\d{4}_.+\.py$/i, name: 'Django migration' },
      { re: /supabase\/migrations\/.+\.sql$/i, name: 'Supabase migration' },
    ];
    for (const { re, name } of migrationFilePatterns) {
      if (re.test(filePath)) block(
        `Write to ${name} file by hand: ${filePath}`,
        'Edit the schema file (e.g. schema.prisma, models/*.ts) and run the ORM CLI to generate the migration (e.g. `prisma migrate dev --name X`). Never hand-write migration files. Use Edit if you need to tweak a CLI-generated file.'
      );
    }
  }

  const cmd = (data?.tool_input?.command || '').toString();
  if (!cmd) process.exit(0);

  // ---- Migration runners — block only destructive ops (reset/rollback/down/clean/undo) ----
  // Forward migrations (dev/deploy/up/latest/upgrade/run) are ALLOWED.
  const destructiveMigration = [
    { re: /\bprisma\s+migrate\s+reset\b/i, name: 'prisma migrate reset' },
    { re: /\bprisma\s+db\s+push\s+.*--force-reset\b/i, name: 'prisma db push --force-reset' },
    { re: /\btypeorm\s+migration:revert\b/i, name: 'typeorm migration:revert' },
    { re: /\bsequelize(?:-cli)?\s+db:migrate:undo\b/i, name: 'sequelize db:migrate:undo' },
    { re: /\bknex\s+migrate:(down|rollback)\b/i, name: 'knex migrate:down/rollback' },
    { re: /\balembic\s+downgrade\b/i, name: 'alembic downgrade' },
    { re: /\bgoose\s+(down|redo|reset)\b/i, name: 'goose down/redo/reset' },
    { re: /\bflyway\s+(clean|undo)\b/i, name: 'flyway clean/undo' },
    { re: /\brails\s+db:(rollback|drop|reset)\b/i, name: 'rails db:rollback/drop/reset' },
    { re: /\b(?:manage\.py|django-admin)\s+(flush|sqlflush|reset)\b/i, name: 'django flush/reset' },
  ];
  for (const { re, name } of destructiveMigration) {
    if (re.test(cmd)) block(
      `${name} reverts/wipes schema or data`,
      'Destructive migrations must be run by the user. AI can run forward migrations (e.g. prisma migrate dev/deploy) but not reset/rollback.'
    );
  }

  // ---- Inline SQL via psql/mysql/sqlite3 ----
  // Match dangerous keywords only when invoked through a DB client.
  const isDbClient = /\b(psql|mysql|sqlite3|cockroach\s+sql|mariadb)\b/i.test(cmd);
  if (isDbClient) {
    const ddlDml = /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|CREATE|GRANT|REVOKE|REPLACE)\b/i;
    if (ddlDml.test(cmd)) block(
      'destructive SQL via DB client (DROP/TRUNCATE/DELETE/UPDATE/INSERT/ALTER/CREATE/GRANT)',
      'Use SELECT/EXPLAIN/ANALYZE only. For DDL, write migration files and let the user run them.'
    );
  }

  // ---- MongoDB shell ----
  if (/\b(mongosh|mongo)\b/i.test(cmd)) {
    const mongoWrite = /\.(drop|deleteOne|deleteMany|remove|insertOne|insertMany|update|updateOne|updateMany|replaceOne|findOneAndUpdate|findOneAndDelete|findOneAndReplace|bulkWrite|createCollection|createIndex|dropIndex|dropDatabase|renameCollection)\s*\(/i;
    if (mongoWrite.test(cmd)) block(
      'destructive MongoDB op (drop/delete/insert/update/createIndex/etc.)',
      'Use find()/aggregate()/count()/explain() only.'
    );
  }

  // ---- Redis ----
  if (/\bredis-cli\b/i.test(cmd)) {
    const redisWrite = /\b(FLUSHALL|FLUSHDB|DEL|UNLINK|SET|HSET|LPUSH|RPUSH|SADD|ZADD|RENAME|EXPIRE|PERSIST|CONFIG\s+SET|SHUTDOWN)\b/i;
    if (redisWrite.test(cmd)) block(
      'destructive Redis op (FLUSH/DEL/SET/...)',
      'Use GET/KEYS/TYPE/TTL/INFO/MONITOR only.'
    );
  }

  process.exit(0);
});
