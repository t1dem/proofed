// Progress lines of a run (Chrome starts, Kane's steps, retries). The PR check prints them to the
// job log; `proofed check` in a terminal sends them to a file, so they don't mix with what it draws.
let write = (line: string) => console.log(line);

export const log = (line: string) => write(line);

export function setLog(fn: (line: string) => void) {
  write = fn;
}
