// The processes a run starts that can outlive it: Kane's process groups, each Chrome, the app's
// server. In CI the runner ends them with the job. In a terminal, Ctrl-C has to, or an orphaned
// Kane keeps spending credits.
type Child = { kill: (signal: NodeJS.Signals) => void; exited: Promise<unknown> };

const children = new Set<Child>();
let stopped = false;

// Set once a stop begins: a run that is still going must not start a retry or a new Chrome.
export const stopping = () => stopped;

// Returns the function that forgets the process once it's gone. A process started after the stop
// began (a run that was between two steps) is killed at once.
export function adopt(child: Child) {
  if (stopped) {
    child.kill("SIGKILL");
    return () => {};
  }
  children.add(child);
  return () => void children.delete(child);
}

// SIGTERM first, so Chrome closes its helpers; whatever is left after `grace` gets SIGKILL. Every
// child gets the SIGKILL, even one that exited: a process group can outlive its leader.
export async function stopChildren(grace = 1500) {
  stopped = true;
  const all = [...children];
  for (const c of all) c.kill("SIGTERM");
  await Promise.race([Promise.all(all.map((c) => c.exited)), new Promise((r) => setTimeout(r, grace))]);
  for (const c of all) c.kill("SIGKILL");
  children.clear();
}

// For an exit that can't wait.
export function killChildren() {
  stopped = true;
  for (const c of children) c.kill("SIGKILL");
  children.clear();
}
