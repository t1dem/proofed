import { mkdirSync, existsSync, readFileSync, readdirSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { kaneLogin } from "./kaneauth.ts";

const LOCK = "/tmp/proofed-kane.lock";
const STALE_MS = 60_000;
const alive = (pid: number) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
};
const ownerOf = (lock: string) => {
  try { return Number(readFileSync(`${lock}/meter`, "utf8").trim()); } catch { return 0; }
};

function reclaim(lock: string) {
  try {
    const original = statSync(lock);
    const owner = ownerOf(lock);
    if (alive(owner) || ((!Number.isSafeInteger(owner) || owner <= 0) && Date.now() - original.mtimeMs < STALE_MS)) return;
    const guard = `${lock}/reclaim`;
    // Serialize takeover, including recovery after a reclaimer was killed.
    // Remove only dead pid markers; rmdir cannot remove a live, nonempty guard.
    try {
      const markers = readdirSync(guard);
      for (const pid of markers) if (/^\d+$/.test(pid) && !alive(Number(pid))) rmSync(`${guard}/${pid}`, { force: true });
      if (markers.length || Date.now() - statSync(guard).mtimeMs >= STALE_MS) rmdirSync(guard);
    } catch {}
    try { mkdirSync(guard); writeFileSync(`${guard}/${process.pid}`, "", { flag: "wx" }); } catch { return; }
    try {
      if (readdirSync(guard).length !== 1) return;
      const current = statSync(lock);
      if (current.dev !== original.dev || current.ino !== original.ino || alive(ownerOf(lock))) return;
      // Keep live contenders' markers when taking over the directory. A run
      // that lost this race can already be about to spend credits.
      for (const file of readdirSync(lock)) {
        const pid = /^contended-(\d+)$/.exec(file)?.[1];
        if (pid && !alive(Number(pid))) rmSync(`${lock}/${file}`, { force: true });
      }
      rmSync(`${lock}/contended`, { force: true });
      writeFileSync(`${lock}/meter`, String(process.pid));
      return true;
    } finally {
      try { rmSync(`${guard}/${process.pid}`, { force: true }); rmdirSync(guard); } catch {}
    }
  } catch {}
}

export async function creditMeter(env: NodeJS.ProcessEnv, lock = LOCK) {
  let owned = false;
  for (let attempt = 0; attempt < 2 && !owned; attempt++) {
    try {
      mkdirSync(lock);
      try { writeFileSync(`${lock}/meter`, String(process.pid)); owned = true; }
      catch { rmSync(lock, { recursive: true, force: true }); break; }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") break;
      if (attempt === 0) owned = reclaim(lock) === true;
    }
  }
  if (!owned) {
    // A competing Proofed run invalidates attribution for the lock owner too.
    try { writeFileSync(`${lock}/contended-${process.pid}`, ""); writeFileSync(`${lock}/contended`, ""); } catch {}
  }
  const balance = async () => {
    const login = await kaneLogin(env.KANE_CLI ?? "kane-cli", env);
    const value = /^Available credits:\s*(\d+(?:\.\d+)?)\s*$/im.exec(login.balance ?? "")?.[1];
    return value === undefined ? undefined : Number(value);
  };
  // The CLI has no transaction ledger. A balance delta can include remote account
  // activity, which no local process scan or filesystem lock can rule out.
  const before = owned ? await balance() : undefined;
  return async () => {
    try {
      const after = before === undefined ? undefined : await balance();
      return before !== undefined && after !== undefined && after <= before && !existsSync(`${lock}/contended`) && !readdirSync(lock).some((file) => /^contended-\d+$/.test(file))
        ? { before, after, debit: Math.round((before - after) * 10_000) / 10_000 }
        : undefined;
    } finally { if (owned) rmSync(lock, { recursive: true, force: true }); }
  };
}
