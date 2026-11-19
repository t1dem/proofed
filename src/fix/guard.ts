import { gitPath } from "../paths.ts";
// What the fixer may not change: the scenarios it has to make pass, and the workflows that run them.
// Claude is told so in its prompt; this is what holds it to that. A fix that passes because the
// test was edited proves nothing.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { relative } from "node:path";

export const offLimits = (file: string, scenarios: string) =>
  [".proofed", ".github", gitPath(relative(process.cwd(), scenarios))].some((dir) => gitPath(file) === dir || gitPath(file).startsWith(`${dir}/`));

// Puts every off-limits file the working tree changed back as the commit has it, and says which.
export function putBack(scenarios: string) {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  // -z: one entry per NUL, names as they are. A rename is "R  new\0old"; both sides are looked at.
  const entries = git("status", "--porcelain", "-z", "--untracked-files=all").split("\0").filter(Boolean);
  const touched: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const status = entry.slice(0, 2);
    const files = [entry.slice(3), ...(status.includes("R") ? [entries[++i]!] : [])];
    for (const file of files.filter((f) => offLimits(f, scenarios))) {
      touched.push(file);
      if (status === "??") rmSync(file, { force: true });
      else {
        try {
          git("checkout", "HEAD", "--", file);
        } catch {
          // Not in the commit (the new name of a rename): it shouldn't exist.
          git("rm", "-f", "--cached", "--quiet", "--", file);
          rmSync(file, { force: true });
        }
      }
    }
  }
  return touched;
}
