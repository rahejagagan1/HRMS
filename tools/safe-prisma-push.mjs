#!/usr/bin/env node
/* eslint-disable no-console */

// =============================================================================
// safe-prisma-push.mjs
// -----------------------------------------------------------------------------
// Why this exists:
//
//   On 2026-06-12, a routine `prisma db push` against the production database
//   silently dropped the `AttendanceSession` table (and all of its historical
//   rows) because the local Prisma schema had drifted: the model had been
//   renamed in a feature branch and the rename was applied to prod before the
//   accompanying data-migration ran. Prisma's `db push` will accept data loss
//   when invoked with `--accept-data-loss`, and in CI we had been passing that
//   flag for convenience. The result was an irreversible drop of a table that
//   the attendance reporting features depended on. Restoring it required a
//   point-in-time backup restore and several hours of downtime.
//
//   To make this class of mistake impossible going forward, every developer
//   and every CI job MUST run `db push` through this wrapper. The wrapper:
//
//     1. Performs a dry-run `prisma db push --preview-feature` so we surface
//        any schema-validation errors before touching the database.
//     2. Asks Prisma to generate the exact SQL that *would* be applied, via
//        `prisma migrate diff --from-url $DATABASE_URL
//                              --to-schema-datamodel ./prisma/schema.prisma
//                              --script`.
//     3. Greps the generated SQL for destructive operations:
//          - DROP TABLE
//          - DROP COLUMN  (i.e. `ALTER TABLE ... DROP COLUMN ...`)
//          - DROP CONSTRAINT
//        If any are found, it prints them in red on stderr and demands an
//        interactive, typed confirmation of the literal word "DROP" before
//        it will proceed. Anything else aborts with exit code 1.
//     4. Only after explicit confirmation does it actually run
//        `prisma db push --accept-data-loss`.
//
// Usage:
//
//   # One-time setup (the wrapper itself cannot chmod itself):
//   chmod +x tools/safe-prisma-push.mjs
//
//   # Then, in place of `npx prisma db push`:
//   ./tools/safe-prisma-push.mjs
//   # or
//   node tools/safe-prisma-push.mjs
//
// Dependencies:
//
//   None beyond Node's built-ins (child_process, readline, process). Do NOT
//   add npm deps to this file — it has to keep working even when the lockfile
//   is in a broken state.
//
// =============================================================================

import { execSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import process from 'node:process';

// --- ANSI helpers ------------------------------------------------------------
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

const red = (s) => `${RED}${s}${RESET}`;
const bold = (s) => `${BOLD}${s}${RESET}`;
const yellow = (s) => `${YELLOW}${s}${RESET}`;
const green = (s) => `${GREEN}${s}${RESET}`;

// --- Sanity checks -----------------------------------------------------------
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(red('[safe-prisma-push] DATABASE_URL is not set. Refusing to run.'));
  process.exit(1);
}

const SCHEMA_PATH = './prisma/schema.prisma';

// --- Step 1: dry-run db push to catch schema validation errors ---------------
console.error(bold('[safe-prisma-push] Step 1/4: dry-run `prisma db push --preview-feature`'));
let dryRunStdout = '';
let dryRunStderr = '';
try {
  const result = spawnSync(
    'npx',
    ['prisma', 'db', 'push', '--preview-feature'],
    { encoding: 'utf8', env: process.env },
  );
  dryRunStdout = result.stdout || '';
  dryRunStderr = result.stderr || '';
  if (dryRunStdout) process.stderr.write(dryRunStdout);
  if (dryRunStderr) process.stderr.write(dryRunStderr);
  if (result.status !== 0) {
    console.error(red(`[safe-prisma-push] Dry-run failed with exit code ${result.status}.`));
    process.exit(result.status ?? 1);
  }
} catch (err) {
  console.error(red(`[safe-prisma-push] Dry-run threw: ${err.message}`));
  process.exit(1);
}

// --- Step 2: generate the SQL that *would* be applied ------------------------
console.error(bold('\n[safe-prisma-push] Step 2/4: computing SQL diff with `prisma migrate diff`'));
let diffSql = '';
try {
  diffSql = execSync(
    `npx prisma migrate diff --from-url "${DATABASE_URL}" --to-schema-datamodel ${SCHEMA_PATH} --script`,
    { encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'inherit'] },
  );
} catch (err) {
  console.error(red(`[safe-prisma-push] migrate diff failed: ${err.message}`));
  process.exit(1);
}

if (!diffSql.trim() || /^-- This is an empty migration\./m.test(diffSql)) {
  console.error(green('[safe-prisma-push] No changes detected. Database already in sync. Done.'));
  process.exit(0);
}

// --- Step 3: scan for destructive ops ----------------------------------------
console.error(bold('\n[safe-prisma-push] Step 3/4: scanning generated SQL for destructive ops'));

// Match per-statement so we can echo the offending lines back to the user.
// Statements in Prisma's diff output are typically `;`-terminated and one per line,
// but ALTER TABLE statements can span multiple lines, so we split on `;` and
// then test each.
const statements = diffSql
  .split(/;\s*(?:\r?\n|$)/)
  .map((s) => s.trim())
  .filter(Boolean);

const destructivePatterns = [
  { name: 'DROP TABLE',      re: /\bDROP\s+TABLE\b/i },
  { name: 'DROP COLUMN',     re: /\bDROP\s+COLUMN\b/i },
  { name: 'DROP CONSTRAINT', re: /\bDROP\s+CONSTRAINT\b/i },
];

const destructive = [];
for (const stmt of statements) {
  for (const { name, re } of destructivePatterns) {
    if (re.test(stmt)) {
      destructive.push({ kind: name, sql: stmt });
      break; // one classification per statement is enough
    }
  }
}

if (destructive.length > 0) {
  console.error(red(bold('\n[safe-prisma-push] DESTRUCTIVE OPERATIONS DETECTED:')));
  console.error(red('-------------------------------------------------------------'));
  for (const { kind, sql } of destructive) {
    console.error(red(`[${kind}]`));
    console.error(red(sql + ';'));
    console.error('');
  }
  console.error(red('-------------------------------------------------------------'));
  console.error(
    yellow(
      'These statements will permanently delete data if you continue.\n' +
        'Remember the AttendanceSession incident on 2026-06-12.\n',
    ),
  );
  console.error(
    bold(
      'To proceed, type the literal word DROP (uppercase) and press Enter.\n' +
        'Anything else will abort.',
    ),
  );

  // Refuse to auto-confirm in non-interactive contexts (CI, piped input, etc.).
  if (!process.stdin.isTTY) {
    console.error(
      red(
        '[safe-prisma-push] Refusing destructive push in a non-interactive session. ' +
          'Run this command from a real terminal.',
      ),
    );
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((resolve) => {
    rl.question('confirm> ', (a) => {
      rl.close();
      resolve(a);
    });
  });

  if (answer !== 'DROP') {
    console.error(red(`[safe-prisma-push] Got "${answer}", expected "DROP". Aborting.`));
    process.exit(1);
  }

  console.error(green('[safe-prisma-push] Confirmation accepted. Proceeding with --accept-data-loss.'));
} else {
  console.error(green('[safe-prisma-push] No destructive operations detected.'));
}

// --- Step 4: actually apply the change ---------------------------------------
console.error(bold('\n[safe-prisma-push] Step 4/4: applying with `prisma db push --accept-data-loss`'));
const finalArgs = ['prisma', 'db', 'push', '--accept-data-loss'];
const final = spawnSync('npx', finalArgs, {
  stdio: 'inherit',
  env: process.env,
});

if (final.status !== 0) {
  console.error(red(`[safe-prisma-push] Final push failed with exit code ${final.status}.`));
  process.exit(final.status ?? 1);
}

console.error(green('[safe-prisma-push] Done.'));
process.exit(0);
