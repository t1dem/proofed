import { posix } from "node:path";

// git and scenario globs use '/', even when the working tree uses Windows paths.
export const gitPath = (file: string) => file.replaceAll("\\", "/");
export const matchesPath = (file: string, glob: string) => posix.matchesGlob(gitPath(file), gitPath(glob));
