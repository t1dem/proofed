import { posix } from "node:path";

// git and scenario globs use '/', even when the working tree uses Windows paths.
export const gitPath = (file: string) => process.platform === "win32" ? file.replaceAll("\\", "/") : file;

export function matchesPath(file: string, glob: string) {
  const path = gitPath(file);
  const pattern = gitPath(glob);
  if (posix.matchesGlob(path, pattern)) return true;
  if (!/(?:^|\/)\.(?!\.?(?:\/|$))/.test(path)) return false;
  // Node excludes leading dots from wildcards. Prefix both sides with a literal
  // that cannot appear in a git path, leaving globstars and navigation segments alone.
  const prefix = (value: string, isPattern: boolean) => value.replace(/[^/]+/g, (part) =>
    part === "." || part === ".." || (isPattern && part === "**") ? part : `\0${part}`);
  const prefixed = prefix(path, false);
  const matches = (pattern: string) => posix.matchesGlob(prefixed, prefix(pattern, true));
  if (matches(pattern)) return true;
  // A brace alternative can expose a whole globstar segment, so expand those alternatives first.
  if (!/(?:[{,]\*\*(?=[/,}])|\/\*\*(?=[,}]))/.test(pattern)) return false;
  let remaining = 1_000;
  const matchAlternative = (pattern: string): boolean => {
    if (--remaining < 0) return false;
    const group = /(?<!\$)\{([^{}]*,[^{}]*)\}/.exec(pattern);
    if (!group) return matches(pattern);
    const end = group.index + group[0].length;
    return group[1]!.split(",").some((part) => matchAlternative(pattern.slice(0, group.index) + part + pattern.slice(end)));
  };
  return matchAlternative(pattern);
}
