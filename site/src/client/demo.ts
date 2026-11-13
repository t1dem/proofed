// Sample data for `pnpm dev` at /app?demo. Never part of a production build (see lib.ts).
// PR #2 of the demo store is real, clips included; the rest is made up to fill the screens.
import type { MeView, RepoView } from "../worker/api";
import type { PullDetail, PullView, Run } from "../worker/runs";

const min = 60_000;
const hour = 60 * min;
const now = Date.now();
const store = "t1dem/proofed-demo-store";

const me: MeView = { login: "t1dem", avatar: null, testmu: "t1dem", claude: true, installUrl: "#" };

const shippingSteps = [
  { remark: "Opened the store" },
  { remark: "Added House Espresso to the bag" },
  { remark: "Added Paper Filters to the bag" },
  { remark: "Opened the bag: shipping €4.90, total €49.40" },
  { remark: "Checked the free shipping note. It reads “from €0.50”, the threshold is €50.00", failed: true },
];

const shippingRuns: Run[] = [
  {
    key: "pr-2/84514db-3",
    at: now - 4 * min,
    sha: "84514dbd32279572679948eb3baa665756740ba7",
    skipped: [],
    scenarios: [
      { id: "free-shipping", name: "Free shipping from €50", outcome: "passed", reason: "Shipping is €4.90 at €49.40 and Free at €55.90.", clip: { mp4: "/clips/fixed.mp4", jpg: "/clips/fixed.jpg" }, credits: 27, seconds: 41 },
      { id: "promo-code", name: "Promo code total", outcome: "passed", reason: "Discount −€9.10, shipping Free, total €81.90.", credits: 24, seconds: 36 },
      { id: "checkout", name: "Place an order", outcome: "passed", reason: "The confirmation page says €17.90 was charged.", credits: 20, seconds: 31 },
    ],
    fix: {
      status: "fixed",
      model: "claude-opus-5-5",
      effort: "high",
      commit: "84514dbd32279572679948eb3baa665756740ba7",
      summary: "The threshold moved to cents but the label still divided by 100. The label now formats the same value the cart uses.",
      files: [{ path: "src/pricing.ts", added: 2, removed: 2 }],
      attempts: [
        { summary: "Changed the label text only.", result: "Kane: €55.90 still charged shipping." },
        { summary: "Formats the label from the cents value.", result: "Kane: passes." },
      ],
    },
  },
  {
    key: "pr-2/9f3e1a2-2",
    at: now - 11 * min,
    sha: "9f3e1a2c07d5e84be21c7a1f0d3b5e6f7a8b9c0d",
    scenarios: [
      {
        id: "free-shipping",
        name: "Free shipping from €50",
        outcome: "failed",
        reason: "The page says “Free shipping from €0.50”. Expected €50.",
        diagnosis: "The threshold constant is now in cents, and the note under the headline divides it by 100 a second time.",
        steps: shippingSteps,
        clip: { mp4: "/clips/fail.mp4", jpg: "/clips/fail.jpg" },
        credits: 26,
        seconds: 38,
      },
      { id: "promo-code", name: "Promo code total", outcome: "passed", credits: 24, seconds: 36 },
      { id: "checkout", name: "Place an order", outcome: "passed", credits: 21, seconds: 30 },
    ],
  },
];

const failingShipping: Run[] = shippingRuns.slice(1);

const pulls: PullView[] = [
  {
    repo: store, pr: 2, title: "Make the free shipping threshold easier to read", state: "failing",
    headline: "1 of 3 scenarios broke on this PR.", url: "https://github.com/t1dem/proofed-demo-store/pull/2", updatedAt: now - 4 * min,
    scenarios: [
      { name: "Free shipping from €50", outcome: "failed", reason: "The page says “Free shipping from €0.50”. Expected €50." },
      { name: "Promo code total", outcome: "passed" },
      { name: "Place an order", outcome: "passed" },
    ],
  },
  {
    repo: store, pr: 3, title: "Kettle notes mention Chemex", state: "passing",
    headline: "All 2 affected scenarios pass in a real browser.", url: "#", updatedAt: now - 2 * hour,
    scenarios: [
      { name: "Product notes", outcome: "unsure", reason: "It expects “V60”, and this PR changes that text on purpose." },
      { name: "Place an order", outcome: "passed" },
    ],
  },
  {
    repo: "t1dem/tostado-web", pr: 44, title: "Bump the checkout form to the new inputs", state: "blocked",
    headline: "Kane couldn't finish 1 of 4 scenarios. Nothing points at the code yet.", url: "#", updatedAt: now - 3 * hour,
    scenarios: [
      { name: "Place an order", outcome: "error", reason: "The page didn't load in 30 s." },
      { name: "Promo code total", outcome: "passed" },
      { name: "Free shipping from €50", outcome: "passed" },
      { name: "Sign in", outcome: "passed" },
    ],
  },
  {
    repo: "t1dem/tostado-web", pr: 41, title: "Move cart totals into a hook", state: "fixing",
    headline: "1 of 4 scenarios broke on this PR.", url: "#", updatedAt: now - min,
    scenarios: [
      { name: "Promo code total", outcome: "failed", reason: "Total shows €91.00, not €81.90." },
      { name: "Place an order", outcome: "passed" },
      { name: "Free shipping from €50", outcome: "passed" },
      { name: "Sign in", outcome: "passed" },
    ],
  },
  {
    repo: store, pr: 1, title: "Simplify promo code lookup", state: "passing",
    headline: "All 3 affected scenarios pass in a real browser.", url: "#", updatedAt: now - 26 * hour,
    scenarios: [
      { name: "Promo code total", outcome: "passed" },
      { name: "Free shipping from €50", outcome: "passed" },
      { name: "Place an order", outcome: "passed" },
    ],
    fix: { status: "fixed", model: "claude-haiku-5-5", effort: "xhigh", commit: "4be21c7a9d", attempts: 2 },
  },
  {
    repo: "t1dem/proofed", pr: 18, title: "Camera lands on each element before it's clicked", state: "passing",
    headline: "This PR doesn't touch the files of any scenario, so there was nothing to run.", url: "#", updatedAt: now - 49 * hour, scenarios: [],
  },
  {
    repo: "t1dem/tostado-web", pr: 39, title: "Checkout: validate the postcode", state: "passing",
    headline: "All 4 affected scenarios pass in a real browser.", url: "#", updatedAt: now - 70 * hour,
    scenarios: ["Place an order", "Promo code total", "Free shipping from €50", "Sign in"].map((name) => ({ name, outcome: "passed" })),
  },
];

const repos: RepoView[] = [
  { name: store, url: "#", private: false, installationId: 1, setup: "active", paused: false, secrets: ["LT_USERNAME", "LT_ACCESS_KEY", "CLAUDE_CODE_OAUTH_TOKEN"], fixer: { model: "claude-opus-5-5", effort: "high" } },
  { name: "t1dem/tostado-web", url: "#", private: true, installationId: 1, setup: "pr-open", setupPr: "#", paused: false, secrets: ["LT_USERNAME"], fixer: { model: "claude-haiku-5-5", effort: "xhigh" } },
  { name: "t1dem/braatens-site", url: "#", private: true, installationId: 1, setup: "none", paused: false, secrets: [], fixer: null },
];

// /app?demo=fixed shows PR #2 after Claude's fix; plain ?demo shows it still broken.
const fixed = new URLSearchParams(location.search).get("demo") === "fixed";

// "Run again" and "Fix with Claude" show as on their way for a while, as markAsked does in production.
const asked = new Map<string, { action: string; at: number }>();
const DEMO_RUN_MS = 20_000;

export async function demo(path: string, init?: RequestInit): Promise<unknown> {
  await new Promise((done) => setTimeout(done, 150));
  const ask = /^\/api\/pulls\/(.+\/\d+)\/(fix|rerun)$/.exec(path);
  if (ask && init?.method === "POST") {
    asked.set(ask[1]!, { action: ask[2]!, at: Date.now() });
    return { ok: true };
  }
  const pause = /^\/api\/repos\/(.+)\/(pause|resume)$/.exec(path);
  if (pause) {
    const repo = repos.find((r) => r.name === pause[1]);
    if (repo) repo.paused = pause[2] === "pause";
    return { paused: pause[2] === "pause" };
  }
  if (init?.method === "POST") return { ok: true };
  if (path === "/api/me") return me;
  if (path === "/api/repos") return repos;
  const shipping = pulls[0]!;
  const list = fixed
    ? [{ ...shipping, state: "passing" as const, scenarios: shipping.scenarios.map((s) => ({ name: s.name, outcome: "passed" as const })), fix: { status: "fixed" as const, model: "claude-opus-5-5", effort: "high", commit: "84514dbd", attempts: 2 } }, ...pulls.slice(1)]
    : pulls;
  // Pausing a repo in Settings shows on its pull requests, as it does in production.
  const withPause = list.map((p) => {
    const ask = asked.get(`${p.repo}/${p.pr}`);
    const state = ask && Date.now() - ask.at < DEMO_RUN_MS ? (ask.action === "fix" ? ("fixing" as const) : ("running" as const)) : p.state;
    return { ...p, state, paused: repos.some((r) => r.name === p.repo && r.paused) };
  });
  if (path === "/api/pulls") return withPause;
  const pull = withPause.find((p) => path === `/api/pulls/${p.repo}/${p.pr}`);
  if (!pull) throw new Error("Proofed hasn't reported on that pull request.");
  const runs = pull.pr === 2 && pull.repo === store ? (fixed ? shippingRuns : failingShipping) : [];
  return { pull, runs } satisfies PullDetail;
}
