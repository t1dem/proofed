// The dashboard's view of a run while it's going: which scenario Kane is on, its steps as they
// happen, a frame of its Chrome every couple of seconds, and what the fixer is doing. Sent to
// Proofed's server (site/src/worker/live.ts) as the job's OIDC token proves the repository.
// It never holds up the run: sends are batched, nothing waits on them but end(), and a server that
// keeps refusing switches it off.
import type { Step } from "./kane.ts";
import type { Live, LiveFix, LiveScenario } from "./livefile.ts";
import type { Scenario } from "./scenarios.ts";
import { oidcToken, serverUrl } from "./server.ts";

const SEND_EVERY = 1000;
const FRAME_EVERY = 2000;
const GIVE_UP_AFTER = 5;

let state: Live | undefined;
let server: string | undefined;
let pending: NodeJS.Timeout | undefined;
let lastSent = 0;
// Sends go one after another, so the server never gets an older state after a newer one.
let chain: Promise<unknown> = Promise.resolve();
let failures = 0;
const lastFrame = new Map<string, number>();

async function post(path: string, body: string | Blob, type: string) {
  if (!server) return;
  try {
    const res = await fetch(new URL(path, server), {
      method: "POST",
      headers: { authorization: `Bearer ${await oidcToken()}`, "content-type": type },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`${server} answered ${res.status}`);
    failures = 0;
  } catch (e) {
    if (++failures < GIVE_UP_AFTER) return;
    console.log(`Live progress is off for this run: ${e instanceof Error ? e.message : e}`);
    state = undefined;
  }
}

function flush() {
  clearTimeout(pending);
  pending = undefined;
  lastSent = Date.now();
  chain = chain.then(() => state && post("/api/actions/live", JSON.stringify(state), "application/json"));
  return chain;
}

function changed() {
  if (!state || pending) return;
  pending = setTimeout(flush, Math.max(0, lastSent + SEND_EVERY - Date.now()));
  pending.unref();
}

const scenarioOf = (id: string) => state?.scenarios.find((s) => s.id === id);

export const live = {
  on: () => !!state,

  // A run of the check (cli.ts) or the fixer (fix.ts) on this pull request starts.
  start(o: { kind: Live["kind"]; pr: number | undefined; sha: string; runUrl: string | undefined }) {
    server = serverUrl();
    if (!server || !o.pr) return;
    const run = `${process.env.GITHUB_RUN_ID ?? "local"}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`;
    state = { run, pr: o.pr, sha: o.sha, kind: o.kind, startedAt: Date.now(), ...(o.runUrl && { runUrl: o.runUrl }), scenarios: [] };
    changed();
  },

  // The scenarios Kane is about to run, all waiting for a Chrome.
  track(scenarios: Scenario[]) {
    if (!state) return;
    state.scenarios = scenarios.map((s): LiveScenario => ({ id: s.id, name: s.name, status: "waiting", steps: [] }));
    changed();
  },

  scenario(id: string, patch: Partial<Omit<LiveScenario, "id" | "name">>) {
    const s = scenarioOf(id);
    if (!s) return;
    Object.assign(s, patch);
    changed();
  },

  // Kane announces a step ("running") and then reports it done or failed under the same number.
  step(id: string, step: Step) {
    const s = scenarioOf(id);
    if (!s) return;
    const at = s.steps.findIndex((x) => x.n === step.step);
    const next = { n: step.step, remark: step.remark || s.steps[at]?.remark || "", status: step.status };
    if (at === -1) s.steps.push(next);
    else s.steps[at] = next;
    changed();
  },

  fix(patch: Partial<LiveFix>) {
    if (!state) return;
    state.fix = { attempt: 1, of: 1, doing: "writing", model: "", effort: "", tries: [], ...state.fix, ...patch };
    changed();
  },

  // What Kane's Chrome shows now, at most every couple of seconds per scenario.
  frame(id: string, jpeg: Uint8Array) {
    if (!state || Date.now() - (lastFrame.get(id) ?? 0) < FRAME_EVERY) return;
    lastFrame.set(id, Date.now());
    const query = new URLSearchParams({ run: state.run, pr: String(state.pr), scenario: id });
    void post(`/api/actions/live/frame?${query}`, new Blob([jpeg as Uint8Array<ArrayBuffer>]), "image/jpeg");
  },

  // Before the report: the last state goes out, and nothing after it.
  async end() {
    if (!state) return;
    await flush();
    state = undefined;
  },
};
