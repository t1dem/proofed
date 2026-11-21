// Checks that the live demo (/try) still works, so a broken one is noticed before a visitor finds it
// (.github/workflows/demo-check.yml). It was down for four days once: the demo store's workflow was
// switched off, then its Claude token was revoked, and nothing said so.
//
//   quick  free: the site answers, the demo store's workflow is on, the last live run ended in a fix
//   full   starts a real run as a visitor would and waits for the fix; spends Kane credits and fixer time
import { appendFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

type TryRun = { pr: number; state: string; fixed: boolean; result?: string };
type TryView = { repo: string; bugs: { id: string }[]; current: TryRun | null; recent: TryRun[]; left: number };

const site = (process.env.PROOFED_SITE ?? "https://proofed.neptunescodm.workers.dev").replace(/\/+$/, "");
const github = process.env.GITHUB_API_URL ?? "https://api.github.com";
const WORKFLOW = ".github/workflows/proofed.yml";
// A run holds the line for 25 minutes at most (RUN_LASTS in site/src/worker/try.ts).
const RUN_LASTS = 30 * 60_000;

// For the workflow's issue steps: `problem` is what is wrong, in words; `skipped` is a check that proved nothing.
const output = (name: string, value: string) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value.replaceAll("\n", " ")}\n`);
};
const skip = (why: string) => {
  console.log(why);
  output("skipped", "true");
};

async function request(url: string, init?: RequestInit) {
  const once = () => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  // One retry of a read: a dropped connection is not a broken demo. A POST may have opened a pull request already.
  const answer = init?.method === "POST" ? once() : once().catch(() => sleep(5000).then(once));
  return answer.catch((e: unknown) => {
    throw new Error(`${url} can't be reached: ${e instanceof Error ? e.message : e}`);
  });
}

async function view() {
  const res = await request(`${site}/api/try`);
  if (!res.ok) throw new Error(`${site}/api/try answered ${res.status}: the /try page can't load.`);
  return (await res.json().catch(() => {
    throw new Error(`${site}/api/try answered ${res.status} with something that isn't JSON.`);
  })) as TryView;
}

// Whatever a run needs before it can start.
async function ready() {
  const health = await request(`${site}/api/health`);
  if (!health.ok) throw new Error(`${site}/api/health answered ${health.status}.`);
  const now = await view();
  const url = `${github}/repos/${now.repo}/actions/workflows`;
  const token = process.env.GITHUB_TOKEN;
  let res = await request(url, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
  // The demo store is public: a job token that can't read another repository still isn't needed.
  if (!res.ok && token) res = await request(url);
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for the workflows of ${now.repo}.`);
  const { workflows } = (await res.json()) as { workflows: { path: string; state: string }[] };
  const state = workflows.find((w) => w.path === WORKFLOW)?.state ?? "missing";
  if (state !== "active") {
    throw new Error(`The Proofed workflow in ${now.repo} is ${state}, so a pull request opened from ${site}/try is never checked and the page waits. Turn it on: \`gh workflow enable proofed.yml -R ${now.repo}\`.`);
  }
  return now;
}

const unfixed = (which: string, run: TryRun, repo: string) =>
  `${which} ${repo}#${run.pr} ended without a fix (${run.state}${run.result ? `: ${run.result}` : ""}). The report on the pull request says why: https://github.com/${repo}/pull/${run.pr}`;

async function quick() {
  const { recent, repo } = await ready();
  const last = recent[0];
  if (last && !last.fixed) throw new Error(unfixed("The last live run", last, repo));
  console.log(`The demo is ready${last ? `; the last run, #${last.pr}, was fixed` : ""}.`);
}

async function full() {
  const now = await ready();
  if (now.current) return skip(`A run is going (#${now.current.pr}); not starting another.`);
  if (now.left === 0) return skip("No live runs left today; not starting one.");
  const bug = now.bugs[Math.floor(Date.now() / 86_400_000) % now.bugs.length]?.id;
  const res = await request(`${site}/api/try`, {
    method: "POST",
    headers: { origin: site, "content-type": "application/json" },
    body: JSON.stringify({ bug }),
  });
  const started = (await res.json().catch(() => ({}))) as { pr?: number; error?: string };
  // Someone else took the slot, or this address used up its runs: the demo itself is fine.
  if (res.status === 409 || res.status === 429) return skip(`Not started: ${started.error}`);
  if (!res.ok || !started.pr) throw new Error(`${site}/try couldn't open a pull request (${res.status}${started.error ? `: ${started.error}` : ""}).`);
  console.log(`Started ${bug}: ${site}/try/${started.pr}`);
  for (const deadline = Date.now() + RUN_LASTS; Date.now() < deadline; ) {
    await sleep(30_000);
    const run = (await view()).recent.find((r) => r.pr === started.pr);
    if (!run) continue;
    if (!run.fixed) throw new Error(unfixed("The live run", run, now.repo));
    return console.log(`#${run.pr}: ${run.result ?? "fixed"}`);
  }
  throw new Error(`The live run ${now.repo}#${started.pr} didn't finish in ${RUN_LASTS / 60_000} minutes: ${site}/try/${started.pr}`);
}

try {
  const mode = process.argv[2];
  if (mode === "quick") await quick();
  else if (mode === "full") await full();
  else throw new Error("Usage: node scripts/demo-check.ts quick|full");
} catch (e) {
  // Anything that stops the check is reported, a reply that can't be read included.
  const problem = e instanceof Error ? e.message : String(e);
  console.error(`::error::${problem}`);
  output("problem", problem);
  process.exitCode = 1;
}
