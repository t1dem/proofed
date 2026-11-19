import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { kaneLogin } from "./kaneauth.ts";

const uid = process.getuid?.();
// The Windows profile has per-user ACLs; POSIX uses a uid-scoped private temp directory.
export const creditLockPath = (dir = uid === undefined ? homedir() : tmpdir()) =>
  join(dir, uid === undefined ? ".proofed-kane-meter.lock" : `proofed-kane-${uid}.lock`);
const registration = /^(\d+)-[\da-f-]{36}(\.done)?$/;
const alive = (pid: number) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
};

const privateDirectory = (dir: string) => {
  const stat = lstatSync(dir);
  return stat.isDirectory() && (uid === undefined || (stat.uid === uid && (stat.mode & 0o077) === 0));
};

export async function creditMeter(env: NodeJS.ProcessEnv, lock = creditLockPath()) {
  const id = `${process.pid}-${randomUUID()}`;
  const active = join(lock, id);
  const warning = join(active, "contended");
  let registered = false;
  let contended = false;
  try {
    try { mkdirSync(lock, { mode: 0o700 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    if (privateDirectory(lock)) {
      mkdirSync(active, { mode: 0o700 });
      registered = true;
      // A run registers before looking for overlap and stays registered until it finishes.
      // Each peer keeps its own warning, even after the run that set it has finished.
      for (const name of readdirSync(lock)) {
        if (name === id) continue;
        const peer = registration.exec(name);
        if (!peer) continue;
        if (peer[2] || !alive(Number(peer[1]))) {
          rmSync(join(lock, name), { recursive: true, force: true });
          continue;
        }
        contended = true;
        try { writeFileSync(join(lock, name, "contended"), "", { flag: "wx" }); }
        catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          if (code !== "ENOENT" && code !== "EEXIST") throw e;
        }
      }
    }
  } catch { contended = true; }

  const balance = async () => {
    const login = await kaneLogin(env.KANE_CLI ?? "kane-cli", env);
    const value = /^Available credits:\s*(\d+(?:\.\d+)?)\s*$/im.exec(login.balance ?? "")?.[1];
    return value === undefined ? undefined : Number(value);
  };
  // The CLI has no transaction ledger. A balance delta can include remote account
  // activity, which no local process scan or filesystem lock can rule out.
  const attributable = () => {
    try { return privateDirectory(lock) && privateDirectory(active) && !existsSync(warning); }
    catch { return false; }
  };
  const before = registered && !contended ? await balance() : undefined;
  return async () => {
    try {
      const after = before === undefined || !attributable() ? undefined : await balance();
      return before !== undefined && after !== undefined && after <= before && attributable()
        ? { before, after, debit: Math.round((before - after) * 10_000) / 10_000 }
        : undefined;
    } finally {
      try {
        if (registered && privateDirectory(lock)) {
          // Retire the registration before cleanup, so a peer cannot add a marker mid-removal.
          const done = `${active}.done`;
          renameSync(active, done);
          rmSync(done, { recursive: true, force: true });
        }
      } catch {}
    }
  };
}
