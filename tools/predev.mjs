// Predev shim — runs before `npm run dev`.
//
// Why this exists: `prisma generate` on Windows often fails with
//
//   EPERM: operation not permitted, rename
//   'D:\nb_dashboard\node_modules\.prisma\client\query_engine-windows.dll.node.tmpNNNN'
//   -> 'D:\nb_dashboard\node_modules\.prisma\client\query_engine-windows.dll.node'
//
// because some other Node process (a previous `next dev`, an orphaned
// `tsx` script, etc.) has the DLL mapped into memory. Windows refuses
// to rename a file with an open handle, so generate aborts and dev
// never starts. The previous fix was "find the process by hand, kill
// it, retry". Doing that on every restart is a paper cut.
//
// Two-layer permanent fix:
//
//   1. SKIP IF UP-TO-DATE.
//      If the Prisma client's generated artifacts are newer than
//      prisma/schema.prisma, nothing changed since the last successful
//      generate. Skip the whole step. This is the common case — most
//      dev restarts happen without a schema edit.
//
//   2. AUTO-KILL + RETRY.
//      If generate runs and hits EPERM/EBUSY on Windows, scan for
//      Node processes whose command line points at this project's
//      next/tsx (i.e. previous dev servers or test scripts), kill
//      them, and retry once. We deliberately scope the kill to
//      dev-related commands so unrelated Node apps on the box are
//      untouched.
//
// Subprocess calls use spawnSync with an argument array and an
// explicit binary path — no shell is invoked at any point, so
// nothing can be interpolated into a shell string. PIDs collected
// from the OS are validated as numeric before they're handed back
// to PowerShell.

import { spawnSync } from "node:child_process";
import { existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createRequire } from "node:module";

const root      = process.cwd();
const schema    = resolve(root, "prisma", "schema.prisma");
const clientDir = resolve(root, "node_modules", ".prisma", "client");
const isWin     = process.platform === "win32";

// Resolve the Prisma CLI's actual JS entry point via Node's own
// module resolution, then invoke `node` on it directly. This avoids
// the .cmd shim in node_modules/.bin/ which can't be spawned on
// Windows without shell:true — and we keep shell:false everywhere
// so no argument is ever passed through a shell interpreter.
const _require   = createRequire(import.meta.url);
const prismaPkg  = JSON.parse(readFileSync(_require.resolve("prisma/package.json"), "utf8"));
const prismaCliEntry = resolve(
  dirname(_require.resolve("prisma/package.json")),
  prismaPkg.bin?.prisma ?? "build/index.js",
);

function log(msg) { console.log(`[predev] ${msg}`); }
function err(msg) { console.error(`[predev] ${msg}`); }

function clientUpToDate() {
  if (!existsSync(clientDir) || !existsSync(schema)) return false;
  try {
    const schemaMtime = statSync(schema).mtimeMs;
    const entries = readdirSync(clientDir);
    if (entries.length === 0) return false;
    const youngest = Math.max(...entries.map((f) => statSync(join(clientDir, f)).mtimeMs));
    // 1s tolerance for filesystem-clock skew on Windows.
    return youngest >= schemaMtime - 1000;
  } catch {
    return false;
  }
}

function runPrisma(...args) {
  // shell:false — args go straight to Node, no shell interpolation
  // anywhere. The interpreter and script path are also fully under
  // our control (process.execPath + Node module resolution of the
  // prisma package).
  const r = spawnSync(
    process.execPath,
    [prismaCliEntry, ...args],
    { stdio: "inherit", shell: false },
  );
  return { ok: r.status === 0, status: r.status, msg: r.error ? String(r.error) : "" };
}

/** Same as runPrisma but captures stdout/stderr so the caller can
 *  pattern-match against the output (e.g. detect a connectivity
 *  failure vs a real migration error). Output is also echoed to
 *  the console so the user sees what happened. */
function runPrismaCapture(...args) {
  const r = spawnSync(
    process.execPath,
    [prismaCliEntry, ...args],
    { encoding: "utf8", shell: false },
  );
  const out = (r.stdout || "") + (r.stderr || "");
  if (out) process.stdout.write(out);
  return { ok: r.status === 0, status: r.status, out };
}

function killStaleDevProcesses() {
  if (!isWin) return 0;
  try {
    // List Node processes (other than ours) that look like project
    // dev / test invocations. We deliberately CAST A WIDER NET than
    // a strict `nb_dashboard`-path match: tsx scripts launched with
    // a relative path don't carry the project folder in their
    // command line, but they still hold the Prisma DLL open.
    //
    // Match criteria (any of):
    //   • cmdline contains `next` → a previous `next dev` server
    //   • cmdline contains `tsx`  → a previous tsx script (esp.
    //                                anything under scripts/)
    //   • cmdline contains `prisma` → a previous prisma CLI run
    //   • cmdline ends with `scripts/...ts(x)?` → diag scripts run
    //                                              via npx tsx
    //
    // EXCLUDE anything that looks like an MCP server (`mcp`) so we
    // don't kill the user's IDE / Claude Code MCP processes. Also
    // exclude our own PID and any direct child of ours (the
    // prisma-generate node process we just spawned).
    const ps = `
      $self = ${Number(process.pid)};
      $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$self").ParentProcessId;
      Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object {
          $_.ProcessId -ne $self -and
          $_.ProcessId -ne $parent -and
          $_.CommandLine -and
          $_.CommandLine -notmatch 'mcp' -and
          (
            $_.CommandLine -match 'next' -or
            $_.CommandLine -match 'tsx' -or
            $_.CommandLine -match 'prisma' -or
            $_.CommandLine -match 'scripts[/\\\\]'
          )
        } |
        Select-Object -ExpandProperty ProcessId
    `;
    const out = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", ps],
      { encoding: "utf8", shell: false },
    );
    const pids = (out.stdout || "")
      .trim()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s));      // numeric-only — sanitises whatever PS returned
    if (pids.length === 0) return 0;
    log(`killing ${pids.length} stale dev process(es) holding the Prisma client: ${pids.join(", ")}`);
    // Each PID is now known to be /^\d+$/ — safe to interpolate into
    // the Stop-Process invocation.
    spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Stop-Process -Id ${pids.join(",")} -Force -ErrorAction SilentlyContinue`,
      ],
      { encoding: "utf8", shell: false },
    );
    return pids.length;
  } catch (e) {
    err(`could not scan for stale processes: ${e?.message ?? e}`);
    return 0;
  }
}

function run() {
  // Step 1 — migrate deploy (idempotent + fast + no DLL conflict).
  // Capture output so we can tell a DB-reachability failure (which
  // we tolerate during local UI dev) from a real migration error
  // (which we still fail loud on).
  //
  // Override switches:
  //   SKIP_PRISMA_MIGRATE=1  →  skip migrate deploy entirely
  //   SKIP_PREDEV=1          →  skip the whole predev (incl. generate)
  if (process.env.SKIP_PREDEV === "1") {
    log("SKIP_PREDEV=1 — skipping predev entirely.");
    return;
  }
  if (process.env.SKIP_PRISMA_MIGRATE !== "1") {
    const mig = runPrismaCapture("migrate", "deploy");
    if (!mig.ok) {
      const isUnreachable =
        /P1001|Can'?t reach database server|ECONNREFUSED|ETIMEDOUT/i.test(mig.out);
      if (isUnreachable) {
        log("──────────────────────────────────────────────────────────");
        log("DATABASE UNREACHABLE — skipping migrate deploy and continuing.");
        log("The dev server will start but API routes hitting the DB will fail.");
        log("UI-only work (e.g. the careers page) still works fine.");
        log("To suppress this check entirely, run: SKIP_PRISMA_MIGRATE=1 npm run dev");
        log("──────────────────────────────────────────────────────────");
      } else {
        err(`prisma migrate deploy failed (status=${mig.status})`);
        process.exit(1);
      }
    }
  } else {
    log("SKIP_PRISMA_MIGRATE=1 — skipping migrate deploy.");
  }

  // Step 2 — skip generate if the client is already up-to-date.
  if (clientUpToDate()) {
    log("Prisma client is up-to-date with schema.prisma — skipping generate.");
    return;
  }

  // Step 3 — generate; on Windows EPERM, kill stale dev processes
  // and retry once.
  let gen = runPrisma("generate");
  if (!gen.ok && isWin) {
    log("prisma generate failed — checking for stale dev processes holding the client DLL.");
    const killed = killStaleDevProcesses();
    if (killed > 0) {
      // Wait for the OS to release the file handles after the forced
      // terminations — Windows is sometimes lazy here. 2.5s is enough
      // for the kernel to flush even when several processes had the
      // engine DLL mapped at once.
      const until = Date.now() + 2500;
      while (Date.now() < until) { /* spin */ }
      log("retrying prisma generate…");
      gen = runPrisma("generate");
    }
  }
  if (!gen.ok) {
    err("prisma generate failed.");
    if (isWin) {
      err("If this keeps happening, manually run:");
      err("  Get-Process node | Where-Object { $_.WorkingSet -gt 100MB } | Stop-Process -Force");
    }
    process.exit(1);
  }
}

run();
