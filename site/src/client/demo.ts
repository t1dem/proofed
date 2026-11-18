// Sample data for /app?demo (see lib.ts), loaded as its own chunk only then. Proofed checks its own
// dashboard against it (.proofed/scenarios/dashboard-*.md), so the texts here are what those
// scenarios expect.
//
// The pull requests of t1dem/proofed-demo-store and t1dem/proofed are real. What the demo shows for
// them is copied from GitHub: the report comment (and its edit history), the commits, the run file
// next to the clips on the repo's proofed-clips branch, and the Actions run. Where none of those
// says something (which model fixed demo store PR #1, what one scenario of a demo store run cost),
// it isn't stated. Everything in sample/… is made up, to show the states no real pull request is
// in right now, and has no GitHub links. The sample clips (public/clips) are the demo store's own
// recordings of PR #2, standing in for a sample run.
import { summarize, type Live, type LiveFix, type LiveStatus } from "../../../src/report/livefile";
import { BLANK_PAGE } from "../../../src/report/runfile";
import type { FixerView, MeView, RepoView } from "../worker/api";
import type { LiveView } from "../worker/live";
import type { PullDetail, PullView, Run } from "../worker/runs";

const min = 60_000;
const hour = 60 * min;
const now = Date.now();
const store = "t1dem/proofed-demo-store";
const proofed = "t1dem/proofed";
const sample = "sample/sample-coffee-store";

const me: MeView = { login: "t1dem", avatar: null, testmu: "t1dem", claude: true, codex: true, installUrl: "#" };

const at = (iso: string) => Date.parse(iso);
const actions = (repo: string, id: number) => `https://github.com/${repo}/actions/runs/${id}`;
// A clip on the repo's proofed-clips branch. The demo store's older runs have no still, only the GIF.
const clip = (repo: string, run: string, id: string, still = true) => {
  const base = `https://github.com/${repo}/raw/proofed-clips/${run}/${id}`;
  return { mp4: `${base}.mp4`, gif: `${base}.gif`, ...(still && { jpg: `${base}.jpg` }) };
};
// Kane's steps as a report's data lists them: "· click: …", and the one that failed "✗ assert: …".
const listed = (steps: string[]) => steps.map((s) => (s.startsWith("✗ ") ? { remark: s.slice(2), failed: true } : { remark: s.replace(/^· /, "") }));

// The demo store's reports predate run files: they give one credits figure for the whole run, which
// goes on the first scenario so the page's total (all it shows) is the report's.

const storePromo: Run[] = [
  {
    key: "pr-1/6434ed5-43357060269",
    at: at("2026-11-13T11:01:49Z"),
    sha: "6434ed5a977ec0e349faf5f9ab5497ebf6713f50",
    runUrl: actions(store, 43357060269),
    skipped: [],
    scenarios: [
      { id: "checkout", name: "Place an order", outcome: "passed", clip: clip(store, "pr-1/6434ed5-43357060269", "checkout", false), credits: 62 },
      { id: "free-shipping", name: "Free shipping from €50", outcome: "passed", clip: clip(store, "pr-1/6434ed5-43357060269", "free-shipping", false) },
      { id: "promo-code", name: "Promo code total", outcome: "passed", clip: clip(store, "pr-1/6434ed5-43357060269", "promo-code", false) },
    ],
  },
  {
    // Not run in Actions (its clips are in a "-local" folder): no logs to link to.
    key: "pr-1/1787177-local",
    at: at("2026-11-13T00:07:11Z"),
    sha: "17871772d9d7743c8b60739a1d66a9cedc0be9af",
    skipped: [],
    scenarios: [
      {
        id: "promo-code",
        name: "Promo code total",
        outcome: "failed",
        reason: "Final verification failed: \"the discount is −€9.10, shipping is Free and the total is €81.90.\"",
        diagnosis: "The promotion field displayed the entered code as uppercase, and applying it left the required €9.10 discount and €81.90 total missing.",
        clip: clip(store, "pr-1/1787177-local", "promo-code", false),
        credits: 70,
      },
      { id: "checkout", name: "Place an order", outcome: "passed", clip: clip(store, "pr-1/1787177-local", "checkout", false) },
      { id: "free-shipping", name: "Free shipping from €50", outcome: "passed", clip: clip(store, "pr-1/1787177-local", "free-shipping", false) },
    ],
  },
];

const storeShipping: Run[] = [
  {
    key: "pr-2/84514db-43393225329",
    at: at("2026-11-13T08:30:59Z"),
    sha: "84514dbd32279572679948eb3baa665756740ba7",
    runUrl: actions(store, 43393225329),
    skipped: [],
    scenarios: [
      { id: "checkout", name: "Place an order", outcome: "passed", clip: clip(store, "pr-2/84514db-43393225329", "checkout", false), credits: 58 },
      { id: "free-shipping", name: "Free shipping from €50", outcome: "passed", clip: clip(store, "pr-2/84514db-43393225329", "free-shipping", false) },
      { id: "promo-code", name: "Promo code total", outcome: "passed", clip: clip(store, "pr-2/84514db-43393225329", "promo-code", false) },
    ],
    // The model and effort are in the fix job's log (PROOFED_CLAUDE_MODEL, PROOFED_CLAUDE_EFFORT).
    fix: {
      status: "fixed",
      model: "claude-haiku-5-5",
      effort: "xhigh",
      commit: "84514dbd32279572679948eb3baa665756740ba7",
      summary:
        "I didn't run `pnpm typecheck`, `pnpm build`, or the Kane scenarios because the command was blocked for approval. By hand, the Huila order is €13.00 + €4.90 shipping = €17.90, and the free-shipping case is €49.40 below the threshold and €51.00 above it, matching both scenarios.",
      files: [{ path: "src/pricing.ts", added: 1, removed: 1 }],
      attempts: [{ summary: "Fix Place an order, Free shipping from €50", result: "Kane re-ran the scenario in Chrome and it passes." }],
    },
  },
  {
    key: "pr-2/886a15c-43392845103",
    at: at("2026-11-13T08:26:04Z"),
    sha: "886a15c1c2f1f611c589f45fae4d8a22414842e7",
    runUrl: actions(store, 43392845103),
    skipped: [],
    scenarios: [
      {
        id: "checkout",
        name: "Place an order",
        outcome: "failed",
        reason: "Final verification failed: \"the confirmation page says the order is in and that €17.90 was charged\"",
        diagnosis: "The shop priced the Colombia Huila order at €13.00. The bag, checkout total, and confirmation screen consistently show €13.00, so the completed order could not meet the required €17.90 charge.",
        steps: listed([
          "· navigate: Navigate to http://localhost:4173/",
          "· click: Clicking Add Colombia Huila to bag",
          "· click: Clicking Bag (1) in the header",
          "· click: Clicking Checkout in the order summary",
          "· type: Type \"Ada Lovelace\" into \"Full name\"",
          "· type: Type \"ada@example.com\" into \"Email\"",
          "· type: Type \"12 Rua Augusta\" into \"Street address\"",
          "· type: Typing Lisbon into city field",
          "· click: Clicking Place order button in checkout order summary",
          "· wait: PRIMARY: wait for the order confirmation heading to load",
          "· analyze: €17.90 was charged",
          "✗ assert: the confirmation page says the order is in and that €17.90 was charged",
        ]),
        clip: clip(store, "pr-2/886a15c-43392845103", "checkout", false),
        credits: 62,
      },
      {
        id: "free-shipping",
        name: "Free shipping from €50",
        outcome: "failed",
        reason: "Checkpoint assertion failed: \"shipping is €4.90 and the total is €49.40\"",
        diagnosis: "The bag applied free shipping before the order reached the €50 free-shipping threshold, so the shipping charge and total were wrong.",
        steps: listed([
          "· navigate: Navigate to http://localhost:4173/",
          "· click: Click \"Add House Espresso to bag\"",
          "· click: Click \"Add Paper Filters to bag\"",
          "· click: Clicking the Bag link labeled Bag (2)",
          "· wait: PRIMARY: wait for the bag contents to load",
          "· analyze: the total is €49.40",
          "✗ assert: shipping is €4.90 and the total is €49.40",
        ]),
        clip: clip(store, "pr-2/886a15c-43392845103", "free-shipping", false),
      },
      { id: "promo-code", name: "Promo code total", outcome: "passed", clip: clip(store, "pr-2/886a15c-43392845103", "promo-code", false) },
    ],
  },
];

const storeKettle: Run[] = [
  {
    key: "pr-3/9076e2a-43417287773",
    at: at("2026-11-13T11:31:08Z"),
    sha: "9076e2a780af32deaace78433b2de2e6ca496d30",
    runUrl: actions(store, 43417287773),
    skipped: [],
    scenarios: [{ id: "asked-in-comment", name: "What the /proofed comment asks", outcome: "passed", clip: clip(store, "pr-3/9076e2a-43417287773", "asked-in-comment", false), credits: 15 }],
  },
];

// Proofed's own pull requests: the run files as they are on its proofed-clips branch.
const homeSteps = [
  { remark: "navigate: Navigate to http://localhost:4173/" },
  { remark: "wait: PRIMARY: Open the home page" },
  { remark: "analyze: the page shows no error message" },
  { remark: "assert: the main heading is visible and the page shows no error message" },
];

// A page that crashed on load, before screenshots of it were taken: no clip, no steps.
const crashed = (key: string, when: string, sha: string, error: string, seconds: number): Run => ({
  key,
  at: at(when),
  sha,
  runUrl: actions(proofed, Number(key.split("-").at(-1))),
  skipped: [],
  scenarios: ["home", "asked-in-description"].map((id) => ({
    id,
    name: id === "home" ? "Home page loads" : "What the PR description asks",
    outcome: "failed" as const,
    reason: BLANK_PAGE,
    diagnosis: error,
    steps: [],
    seconds,
  })),
});

const proofedCaption: Run[] = [
  {
    key: "pr-3/b3ef393-43508760134",
    at: at("2026-11-13T21:18:30Z"),
    sha: "b3ef3932e150ac33128ac0f92d2ab64660084c63",
    runUrl: actions(proofed, 43508760134),
    skipped: [],
    scenarios: [
      {
        id: "home",
        name: "Home page loads",
        outcome: "passed",
        reason: "Opened the home page as requested.\nThe page loaded successfully with its main heading visible and no error message displayed.",
        steps: homeSteps,
        clip: clip(proofed, "pr-3/b3ef393-43508760134", "home"),
        credits: 6.853639999999999,
        seconds: 74,
      },
      {
        id: "asked-in-description",
        name: "What the PR description asks",
        outcome: "passed",
        reason: "The browser automation run was completed.\nNo specific requested task details or extracted page information were available.\nThe run ended on the localhost page.",
        steps: [{ remark: "navigate: Navigate to http://localhost:4173/" }, { remark: "wait: Waiting verify the example scenario caption starts with its scenario name" }],
        clip: clip(proofed, "pr-3/b3ef393-43508760134", "asked-in-description"),
        credits: 2.85026,
        seconds: 50,
      },
    ],
    fix: {
      status: "fixed",
      model: "claude-haiku-5-5",
      effort: "xhigh",
      commit: "b3ef3932e150ac33128ac0f92d2ab64660084c63",
      summary:
        "The new `scenarioName` line searched the scenario for `title:` while its frontmatter key is `name:`, so `match` returned null and the module threw on load, blanking the landing page; I changed the regex to `/^name: (.+)$/m` (build not run because `pnpm` needed approval).",
      files: [{ path: "site/src/client/Landing.tsx", added: 1, removed: 1 }],
      attempts: [
        {
          summary:
            "The new `scenarioName` line searched the scenario for `title:` while its frontmatter key is `name:`, so `match` returned null and the module threw on load, blanking the landing page; I changed the regex to `/^name: (.+)$/m` (build not run because `pnpm` needed approval).",
          result: "Kane saw it pass.",
        },
      ],
    },
  },
  {
    key: "pr-3/ffad8f2-43507520823",
    at: at("2026-11-13T21:11:25Z"),
    sha: "ffad8f22080c0691b662bbc11fdb8e1acc0a5ecc",
    runUrl: actions(proofed, 43507520823),
    skipped: [],
    scenarios: [
      {
        id: "home",
        name: "Home page loads",
        outcome: "failed",
        reason: "The confirmed home URL remains entirely empty after navigation and repeated waits; no main heading is available.",
        diagnosis: "The page crashes while starting because it tries to read part of something that is missing. As a result, none of the home page content is displayed.",
        suggestion: "Fix the home page startup code to handle the missing value before reading from it, then verify that the heading renders after a fresh visit to the home page.",
        steps: [
          { remark: "navigate: Navigate to http://localhost:4173/" },
          { remark: "wait: PRIMARY: wait for the home page to load" },
          { remark: "wait: PRIMARY: wait for the home page to finish loading" },
          { remark: "navigate: PRIMARY: Open the home page" },
          { remark: "wait: PRIMARY: wait for the home page main heading to load" },
          { remark: "wait: PRIMARY: wait for the home page main heading to finish loading" },
          { remark: "wait: Waiting after opening the home page", failed: true },
        ],
        clip: clip(proofed, "pr-3/ffad8f2-43507520823", "home"),
        credits: 20.3605,
        seconds: 240,
      },
      {
        id: "asked-in-description",
        name: "What the PR description asks",
        outcome: "failed",
        reason: "I checked after loading delays; the landing page remains blank with no example scenario to inspect.",
        diagnosis: "The page hits an error while starting up and does not show its landing-page content.",
        suggestion: "Fix the startup error that reads from a missing value, then reload the landing page and confirm the example caption begins with the scenario name.",
        steps: [
          { remark: "navigate: Navigate to http://localhost:4173/" },
          { remark: "wait: PRIMARY: wait 1000 ms for the landing page content to appear" },
          { remark: "wait: PRIMARY: wait 3000 ms for the landing page content to appear" },
          { remark: "wait: Waiting after checking the landing page", failed: true },
        ],
        clip: clip(proofed, "pr-3/ffad8f2-43507520823", "asked-in-description"),
        credits: 16.2708125,
        seconds: 167,
      },
    ],
  },
];

const proofedSteps: Run[] = [
  {
    key: "pr-10/860dc21-43520630836",
    at: at("2026-11-13T22:38:54Z"),
    sha: "860dc21478bf96f65094ca6d7461be303a9e6569",
    runUrl: actions(proofed, 43520630836),
    skipped: [],
    scenarios: [
      {
        id: "home",
        name: "Home page loads",
        outcome: "passed",
        reason: "Opened the home page as requested.\nThe main heading was visible and no error message was shown.\nThe home page loaded successfully.",
        steps: homeSteps,
        clip: clip(proofed, "pr-10/860dc21-43520630836", "home"),
        credits: 7.0226999999999995,
        seconds: 75,
      },
      {
        id: "asked-in-description",
        name: "What the PR description asks",
        outcome: "passed",
        reason: "Opened the app as requested.\nChecked the example scenario caption on the landing page.\nConfirmed that the caption reads “.proofed/scenarios/free-shipping.md · 4 steps,” including the requested “4 steps” count.",
        steps: [
          { remark: "navigate: Navigate to http://localhost:4173/" },
          { remark: "wait: PRIMARY: Open the app" },
          { remark: "analyze: ANALYZE(textual_visual, 'the caption above the example scenario on the landing p" },
          { remark: "assert: the caption above the example scenario on the landing page shows \"4 steps\" after" },
        ],
        clip: clip(proofed, "pr-10/860dc21-43520630836", "asked-in-description"),
        credits: 16.265925,
        seconds: 72,
      },
    ],
    fix: {
      status: "fixed",
      model: "claude-haiku-5-5",
      effort: "xhigh",
      commit: "860dc21478bf96f65094ca6d7461be303a9e6569",
      summary: "The example scenario's step count read the wrong part of the split text (index 3 instead of 2), which crashed the landing page on load; it now reads the steps part.",
      files: [{ path: "site/src/client/Landing.tsx", added: 1, removed: 1 }],
      attempts: [{ summary: "The example scenario's step count read the wrong part of the split text (index 3 instead of 2), which crashed the landing page on load; it now reads the steps part.", result: "Kane saw it pass." }],
    },
  },
  crashed("pr-10/f81ce18-43520223848", "2026-11-13T22:34:30Z", "f81ce1833b34431fa744536065d8f75fc0756dfe", "TypeError: Cannot read properties of undefined (reading 'trim')", 22),
];

const proofedFileName: Run[] = [
  {
    key: "pr-13/576cf94-43525333535",
    at: at("2026-11-13T23:16:56Z"),
    sha: "576cf948f6c86d588660b099b85a9d60a7a2e97b",
    runUrl: actions(proofed, 43525333535),
    skipped: [],
    scenarios: [
      {
        id: "home",
        name: "Home page loads",
        outcome: "passed",
        reason: "Opened the home page as requested.\nThe main heading was visible and no error message appeared.\nThe home page loaded successfully.",
        steps: homeSteps,
        clip: clip(proofed, "pr-13/576cf94-43525333535", "home"),
        credits: 6.628499999999999,
        seconds: 73,
      },
      {
        id: "asked-in-description",
        name: "What the PR description asks",
        outcome: "passed",
        reason: "Opened the app and viewed its landing page.\nConfirmed that the landing page describes user-facing app behavior.\nVerified that the example scenario caption reads “.proofed/scenarios/free-shipping.md”.",
        steps: [
          { remark: "navigate: Navigate to http://localhost:4173/" },
          { remark: "analyze: ANALYZE(textual_visual, \"The text above doesn't describe something a user can se" },
          { remark: "wait: PRIMARY: view the landing page; role=text | HINTS: container=main page" },
          { remark: "analyze: ANALYZE(textual_visual, 'The caption above the example scenario on the landing p" },
          { remark: "assert: Check that the caption above the example scenario on the landing page still read" },
        ],
        clip: clip(proofed, "pr-13/576cf94-43525333535", "asked-in-description"),
        credits: 19.016347500000002,
        seconds: 112,
      },
    ],
    fix: {
      status: "fixed",
      model: "claude-haiku-5-5",
      effort: "xhigh",
      commit: "576cf948f6c86d588660b099b85a9d60a7a2e97b",
      summary: "The landing page's example scenario had no `file:` line for its caption to read, so the page crashed on load; added that line to the example text.",
      files: [{ path: "site/src/client/Landing.tsx", added: 1, removed: 0 }],
      attempts: [{ summary: "The landing page's example scenario had no `file:` line for its caption to read, so the page crashed on load; added that line to the example text.", result: "Kane saw it pass." }],
    },
  },
  crashed("pr-13/c9a0100-43525075801", "2026-11-13T23:11:14Z", "c9a010027f98b5a4096a15bf4244b7d7525da28f", "TypeError: Cannot read properties of null (reading '1')", 15),
];

// The sample store. `at` is where each step starts in /clips/fail.mp4.
const shippingSteps = [
  { remark: "Opened the store. The note under the headline says “Free shipping from €0.50”", at: 0 },
  { remark: "Added House Espresso to the bag", at: 0.8 },
  { remark: "Added Paper Filters to the bag", at: 2.6 },
  { remark: "Opened the bag", at: 3.8 },
  { remark: "Checked shipping: Free at €44.50, where €4.90 was expected", failed: true, at: 5.5 },
];

const SAMPLE_FIX = "7d2a9f4c1e8b03d65a7f2c9e4b1d8a6053c7e9f1";

const sampleShipping: Run[] = [
  {
    key: "sample-26-2",
    at: now - 4 * min,
    sha: SAMPLE_FIX,
    skipped: [],
    scenarios: [
      { id: "free-shipping", name: "Free shipping from €50", outcome: "passed", reason: "Shipping is €4.90 at €49.40 and Free at €51.00.", clip: { mp4: "/clips/fixed.mp4", jpg: "/clips/fixed.jpg" }, credits: 27, seconds: 41 },
      { id: "promo-code", name: "Promo code total", outcome: "passed", reason: "Discount −€9.10, shipping Free, total €81.90.", credits: 24, seconds: 36 },
      { id: "sign-in", name: "Sign in", outcome: "passed", reason: "The account page greets the customer by name.", credits: 12, seconds: 22 },
    ],
    fix: {
      status: "fixed",
      model: "claude-opus-5-5",
      effort: "high",
      commit: SAMPLE_FIX,
      summary: "The PR wrote the threshold as 50, in euros, while the cart counts in cents. It's back in cents, 50 * 100, so the cart and the note read the same €50.",
      files: [{ path: "src/pricing.ts", added: 1, removed: 1 }],
      attempts: [
        { summary: "Changed the note under the headline only.", result: "Kane: the bag still gave free shipping at €44.50." },
        { summary: "Wrote the threshold in cents again.", result: "Kane: passes." },
      ],
    },
  },
  {
    key: "sample-26-1",
    at: now - 11 * min,
    sha: "e4c1b7a0d29f53c86b1e0a7d4f9235c8b6e1d042",
    skipped: [],
    scenarios: [
      {
        id: "free-shipping",
        name: "Free shipping from €50",
        outcome: "failed",
        reason: "Shipping is Free at €44.50, and the store says “Free shipping from €0.50”. Expected €4.90 below €50.",
        diagnosis: "The threshold is now written as 50, in euros, but the cart still counts in cents: every order ships free.",
        steps: shippingSteps,
        clip: { mp4: "/clips/fail.mp4", jpg: "/clips/fail.jpg" },
        credits: 26,
        seconds: 38,
      },
      { id: "promo-code", name: "Promo code total", outcome: "passed", reason: "Discount −€9.10, shipping Free, total €81.90.", credits: 24, seconds: 36 },
      { id: "sign-in", name: "Sign in", outcome: "passed", reason: "The account page greets the customer by name.", credits: 12, seconds: 21 },
    ],
  },
];

const passedSample = (key: string, when: number, sha: string, names: string[]): Run => ({
  key,
  at: when,
  sha,
  skipped: [],
  scenarios: names.map((name) => ({ id: name.toLowerCase().replace(/\W+/g, "-"), name, outcome: "passed" as const, credits: 20, seconds: 34 })),
});

const runsOf: Record<string, Run[]> = {
  [`${store}#1`]: storePromo,
  [`${store}#2`]: storeShipping,
  [`${store}#3`]: storeKettle,
  [`${proofed}#3`]: proofedCaption,
  [`${proofed}#10`]: proofedSteps,
  [`${proofed}#13`]: proofedFileName,
  [`${sample}#26`]: sampleShipping.slice(1),
  [`${sample}#25`]: [passedSample("sample-25-1", now - 40 * min, "3b9e0f5a7c21d84e6f0a9b3c5d7e1f2a4b6c8d0e", ["Place an order", "Promo code total", "Free shipping from €50", "Sign in"])],
  [`${sample}#24`]: [
    {
      key: "sample-24-1",
      at: now - 3 * min,
      sha: "b81f0c3e5a7d92e4c6b8a0f1d3e5c7a9b2d4f6e8",
      skipped: [],
      scenarios: [
        {
          id: "promo-code",
          name: "Promo code total",
          outcome: "failed",
          reason: "Total shows €91.00, not €81.90.",
          diagnosis: "useCartTotals returns the total before the promo code is taken off.",
          steps: [
            { remark: "Opened the store" },
            { remark: "Added Ethiopia Guji to the bag twice" },
            { remark: "Added the Hand Grinder" },
            { remark: "Opened the bag and applied welcome10" },
            { remark: "Checked the total: €91.00, with no discount taken off", failed: true },
          ],
          credits: 25,
          seconds: 40,
        },
        ...passedSample("", 0, "", ["Place an order", "Free shipping from €50", "Sign in"]).scenarios,
      ],
    },
  ],
  [`${sample}#23`]: [
    {
      key: "sample-23-1",
      at: now - 3 * hour,
      sha: "5c7e9a1b3d5f7092e4b6d8f0a2c4e6b8d0f2a4c6",
      skipped: [],
      scenarios: [
        {
          id: "place-an-order",
          name: "Place an order",
          outcome: "error",
          reason: "The checkout page didn't load in 30 s.",
          steps: [
            { remark: "Opened the store" },
            { remark: "Added Colombia Huila to the bag" },
            { remark: "Opened the bag and pressed Checkout" },
            { remark: "Waited 30 s for the checkout page to load", failed: true },
          ],
          seconds: 52,
        },
        ...passedSample("", 0, "", ["Promo code total", "Free shipping from €50", "Sign in"]).scenarios,
      ],
    },
  ],
  [`${sample}#22`]: [
    {
      key: "sample-22-1",
      at: now - 2 * hour,
      sha: "9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b",
      skipped: [],
      scenarios: [
        {
          id: "product-notes",
          name: "Product notes",
          outcome: "unsure",
          reason: "It expects “V60”, and this PR changes that text on purpose.",
          suggestion: "Have the scenario look for “cone filters” instead.",
          steps: [{ remark: "Opened the store" }, { remark: "Opened Paper Filters" }, { remark: "Read the notes: “Cone filters, size 02”" }, { remark: "Looked for “V60” in the notes" }],
          credits: 9,
          seconds: 28,
        },
        ...passedSample("", 0, "", ["Place an order"]).scenarios,
      ],
    },
  ],
  [`${sample}#20`]: [
    {
      key: "sample-20-1",
      at: now - 49 * hour,
      sha: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c",
      skipped: ["Place an order", "Promo code total", "Free shipping from €50", "Sign in", "Product notes"],
      scenarios: [],
    },
  ],
};

const fourScenarios = ["Place an order", "Promo code total", "Free shipping from €50", "Sign in"];

const pulls: PullView[] = [
  {
    repo: sample, pr: 26, title: "Write the free shipping threshold in euros", state: "failing",
    headline: "1 of 3 scenarios broke on this PR.", url: "#", updatedAt: now - 11 * min,
    scenarios: [
      { name: "Free shipping from €50", outcome: "failed", reason: "Shipping is Free at €44.50, and the store says “Free shipping from €0.50”. Expected €4.90 below €50." },
      { name: "Promo code total", outcome: "passed" },
      { name: "Sign in", outcome: "passed" },
    ],
  },
  {
    repo: sample, pr: 25, title: "Translate the checkout page into Portuguese", state: "running",
    headline: "All 4 affected scenarios pass in a real browser.", url: "#", updatedAt: now - 2 * min,
    scenarios: fourScenarios.map((name) => ({ name, outcome: "passed" })),
  },
  {
    repo: sample, pr: 24, title: "Move cart totals into a hook", state: "fixing",
    headline: "1 of 4 scenarios broke on this PR.", url: "#", updatedAt: now - min,
    scenarios: [
      { name: "Promo code total", outcome: "failed", reason: "Total shows €91.00, not €81.90." },
      { name: "Place an order", outcome: "passed" },
      { name: "Free shipping from €50", outcome: "passed" },
      { name: "Sign in", outcome: "passed" },
    ],
  },
  {
    repo: sample, pr: 22, title: "Call the paper filters cone filters", state: "passing",
    headline: "All 2 affected scenarios pass in a real browser.", url: "#", updatedAt: now - 2 * hour,
    scenarios: [
      { name: "Product notes", outcome: "unsure", reason: "It expects “V60”, and this PR changes that text on purpose." },
      { name: "Place an order", outcome: "passed" },
    ],
  },
  {
    repo: sample, pr: 23, title: "Bump the checkout form to the new inputs", state: "blocked",
    headline: "Kane couldn't finish 1 of 4 scenarios. Nothing points at the code yet.", url: "#", updatedAt: now - 3 * hour,
    scenarios: [
      { name: "Place an order", outcome: "error", reason: "The checkout page didn't load in 30 s." },
      { name: "Promo code total", outcome: "passed" },
      { name: "Free shipping from €50", outcome: "passed" },
      { name: "Sign in", outcome: "passed" },
    ],
  },
  {
    repo: sample, pr: 20, title: "Fix a typo in the README", state: "passing",
    headline: "This PR doesn't touch the files of any scenario, so there was nothing to run.", url: "#", updatedAt: now - 49 * hour, scenarios: [],
  },
  {
    repo: proofed, pr: 13, title: "Landing: take the example scenario's file name from its text", state: "passing",
    headline: "All 2 affected scenarios pass in a real browser.", url: "https://github.com/t1dem/proofed/pull/13", updatedAt: at("2026-11-13T23:16:56Z"),
    scenarios: [{ name: "Home page loads", outcome: "passed" }, { name: "What the PR description asks", outcome: "passed" }],
    fix: { status: "fixed", model: "claude-haiku-5-5", effort: "xhigh", commit: "576cf948f6c86d588660b099b85a9d60a7a2e97b", attempts: 1 },
  },
  {
    repo: proofed, pr: 10, title: "Landing: show how many steps the example scenario has", state: "passing",
    headline: "All 2 affected scenarios pass in a real browser.", url: "https://github.com/t1dem/proofed/pull/10", updatedAt: at("2026-11-13T22:38:54Z"),
    scenarios: [{ name: "Home page loads", outcome: "passed" }, { name: "What the PR description asks", outcome: "passed" }],
    fix: { status: "fixed", model: "claude-haiku-5-5", effort: "xhigh", commit: "860dc21478bf96f65094ca6d7461be303a9e6569", attempts: 1 },
  },
  {
    repo: proofed, pr: 3, title: "Landing: show the scenario's name above the example", state: "passing",
    headline: "All 2 affected scenarios pass in a real browser.", url: "https://github.com/t1dem/proofed/pull/3", updatedAt: at("2026-11-13T21:18:30Z"),
    scenarios: [{ name: "Home page loads", outcome: "passed" }, { name: "What the PR description asks", outcome: "passed" }],
    fix: { status: "fixed", model: "claude-haiku-5-5", effort: "xhigh", commit: "b3ef3932e150ac33128ac0f92d2ab64660084c63", attempts: 1 },
  },
  {
    repo: store, pr: 3, title: "Kettle notes mention Chemex", state: "passing",
    headline: "The affected scenario passes in a real browser.", url: "https://github.com/t1dem/proofed-demo-store/pull/3", updatedAt: at("2026-11-13T11:31:08Z"),
    scenarios: [{ name: "What the /proofed comment asks", outcome: "passed" }],
  },
  {
    // Neither the report nor Claude's commit names the model, and the inbox doesn't show one.
    repo: store, pr: 1, title: "Simplify promo code lookup", state: "passing",
    headline: "All 3 affected scenarios pass in a real browser.", url: "https://github.com/t1dem/proofed-demo-store/pull/1", updatedAt: at("2026-11-13T11:01:49Z"),
    scenarios: [
      { name: "Place an order", outcome: "passed" },
      { name: "Free shipping from €50", outcome: "passed" },
      { name: "Promo code total", outcome: "passed" },
    ],
    fix: { status: "fixed", model: "", effort: "", commit: "6434ed5a977ec0e349faf5f9ab5497ebf6713f50", attempts: 1 },
  },
  {
    repo: store, pr: 2, title: "Make the free shipping threshold easier to read", state: "passing",
    headline: "All 3 affected scenarios pass in a real browser.", url: "https://github.com/t1dem/proofed-demo-store/pull/2", updatedAt: at("2026-11-13T08:30:59Z"),
    scenarios: [
      { name: "Place an order", outcome: "passed" },
      { name: "Free shipping from €50", outcome: "passed" },
      { name: "Promo code total", outcome: "passed" },
    ],
    fix: { status: "fixed", model: "claude-haiku-5-5", effort: "xhigh", commit: "84514dbd32279572679948eb3baa665756740ba7", attempts: 1 },
  },
];

const secrets = ["LT_USERNAME", "LT_ACCESS_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CODEX_API_KEY"];
const repos: RepoView[] = [
  { name: store, url: `https://github.com/${store}`, private: false, installationId: 1, access: "admin", setup: "active", paused: false, secrets: [...secrets], fixer: { model: "claude-opus-5-5", effort: "high", auto: false } },
  { name: proofed, url: `https://github.com/${proofed}`, private: false, installationId: 1, access: "admin", setup: "active", paused: false, secrets: [...secrets], fixer: { provider: "codex", model: "gpt-6.1-sol", effort: "high", auto: false } },
  { name: sample, url: "#", private: true, installationId: 1, access: "admin", setup: "active", paused: false, secrets: [...secrets], fixer: { model: "claude-opus-5-5", effort: "high", auto: false } },
  { name: "sample/landing-page", url: "#", private: true, installationId: 1, access: "admin", setup: "pr-open", setupPr: "#", paused: false, secrets: ["LT_USERNAME"], fixer: { model: "claude-haiku-5-5", effort: "xhigh", auto: false } },
  { name: "sample/docs-site", url: "#", private: true, installationId: 1, access: "admin", setup: "none", paused: false, secrets: [], fixer: null },
];

// The sample pull request that broke, which "Fix with Claude" fixes. /app?demo=fixed shows it after
// Claude's fix; plain ?demo shows it still broken, until a "Fix with Claude" on it has played out.
const FIXABLE = `${sample}/26`;
let fixed = new URLSearchParams(location.search).get("demo") === "fixed";

const keyOf = (pull: { repo: string; pr: number }) => `${pull.repo}/${pull.pr}`;
const historyOf = (pull: PullView) => (keyOf(pull) === FIXABLE ? (fixed ? sampleShipping : sampleShipping.slice(1)) : (runsOf[`${pull.repo}#${pull.pr}`] ?? []));

// A run as the action reports it while it goes (src/report/live.ts), played out on the sample data after
// "Run again", "Fix with Claude" or a question to Kane, so the live view shows without a real run.
// The pull request is busy for as long as its run plays, then shows how it ended.
const STEP_MS = 3000;
const CHROME_MS = 2500; // Chrome and Kane starting
const POST_MS = 3000; // the clips and the report going up
const WRITE_MS = 10_000;
const BUILD_MS = 3000;
const PUSH_MS = 3000;
const AT_ONCE = 3;

type Script = { remarks: string[]; frames: string[]; failed?: string };
const frames = (kind: "fail" | "fixed") => [0, 1, 2, 3, 4].map((i) => `/clips/live/${kind}-${i}.jpg`);
const passing: Record<string, string[]> = {
  "Free shipping from €50": ["Opened the store", "Added House Espresso to the bag", "Added Paper Filters to the bag", "Opened the bag: shipping €4.90, total €49.40", "Pressed + next to Paper Filters: shipping Free, total €51.00"],
  "Promo code total": ["Opened the store", "Added Ethiopia Guji to the bag twice", "Added the Hand Grinder", "Opened the bag and applied welcome10", "Checked the total: −€9.10, shipping Free, €81.90"],
  "Place an order": ["Opened the store", "Added Colombia Huila to the bag", "Opened the bag and pressed Checkout", "Filled in the address and paid", "Checked the confirmation: €17.90 was charged"],
  "Sign in": ["Opened the store", "Pressed Sign in", "Typed the email and the password", "Checked the account page: it greets the customer"],
  "Product notes": ["Opened the store", "Opened Paper Filters", "Read the notes", "Looked for “V60” in the notes"],
};

// The steps Kane takes on a scenario; a broken one ends on the step that failed (`reason`).
function script(name: string, outcome: string, reason?: string): Script {
  if (name === "Free shipping from €50" && outcome === "failed") {
    return { remarks: shippingSteps.slice(0, -1).map((s) => s.remark), frames: frames("fail"), failed: shippingSteps.at(-1)?.remark };
  }
  const remarks = passing[name] ?? ["Opened the page", "Found what the scenario is about", "Checked it"];
  if (outcome !== "failed") return { remarks, frames: frames("fixed") };
  return { remarks: remarks.slice(0, -1), frames: frames("fixed"), failed: reason ?? "Checked it: not what the scenario expects" };
}

type Played = { id: string; name: string; script: Script; outcome: LiveStatus; start: number };

// The scenarios side by side, three at a time, each from when a Chrome frees up.
function schedule(list: { name: string; script: Script; outcome: LiveStatus }[], from: number) {
  const free = Array.from({ length: AT_ONCE }, () => from + CHROME_MS);
  const played = list.map((s, i): Played => {
    const slot = free.indexOf(Math.min(...free));
    const start = free[slot]!;
    free[slot] = start + (s.script.remarks.length + (s.script.failed ? 1 : 0)) * STEP_MS + 1000;
    return { id: `s${i}`, ...s, start };
  });
  return { played, end: Math.max(...free) };
}

function sceneAt(p: Played, t: number, base: number) {
  const remarks = [...p.script.remarks, ...(p.script.failed ? [p.script.failed] : [])];
  if (t < p.start) return { scenario: { id: p.id, name: p.name, status: "waiting" as const, steps: [] } };
  const k = Math.floor((t - p.start) / STEP_MS);
  const over = k >= remarks.length;
  const steps = remarks.slice(0, Math.min(k + 1, remarks.length)).map((remark, i) => ({
    n: i + 1,
    remark,
    status: i < k ? (p.script.failed && i === remarks.length - 1 ? ("failed" as const) : ("done" as const)) : ("running" as const),
  }));
  const shot = Math.min(k, p.script.frames.length - 1);
  return {
    scenario: { id: p.id, name: p.name, status: over ? p.outcome : ("running" as const), steps, startedAt: base + p.start },
    frame: p.script.frames[shot] && { url: p.script.frames[shot]!, at: base + p.start + shot * STEP_MS },
  };
}

type Ask = { action: string; at: number; what?: string };

// Where the run asked for on `pull` is `t` ms after the ask, or undefined once it's over. It starts on
// the commit the last report checked, as a real rerun or fix does. A played run is no run on GitHub,
// so it has no logs to link to.
function play(pull: PullView, ask: Ask, t: number): { live: Live; frames: LiveView["frames"] } | undefined {
  const base = ask.at;
  const sha = historyOf(pull)[0]?.sha ?? "";
  const live: Live = { run: `demo-${ask.at}`, pr: pull.pr, sha, kind: ask.action === "fix" ? "fix" : "check", startedAt: base, scenarios: [] };
  const shots: LiveView["frames"] = {};
  const show = (played: Played[], at: number) => {
    live.scenarios = played.map((p) => {
      const { scenario, frame } = sceneAt(p, at, base);
      if (frame) shots[p.id] = frame;
      return scenario;
    });
  };
  const of = (outcome: string): LiveStatus => (outcome === "skipped" ? "passed" : (outcome as LiveStatus));

  if (ask.action !== "fix") {
    const list =
      ask.action === "check"
        ? [{ name: `“${ask.what ?? "What you asked"}”`, script: { remarks: ["Opened the store", "Found what you asked about", "Checked it: it reads as you said"], frames: frames("fixed") }, outcome: "passed" as const }]
        : pull.scenarios.map((s) => ({ name: s.name, script: script(s.name, s.outcome, s.reason), outcome: of(s.outcome) }));
    const { played, end } = schedule(list, 0);
    if (t > end + POST_MS) return undefined;
    show(played, t);
    return { live, frames: shots };
  }

  // The fixer: Claude writes a change, the app is built, Kane re-runs what broke. On the sample
  // pull request that broke free shipping the first attempt doesn't do it.
  const broken = pull.scenarios.filter((s) => s.outcome === "failed");
  const attempts = keyOf(pull) === FIXABLE ? 2 : 1;
  const fixer = repos.find((r) => r.name === pull.repo)?.fixer ?? { model: "claude-haiku-5-5", effort: "xhigh" };
  const tries = [{ summary: "Changed the note under the headline only.", result: "Kane: the bag still gave free shipping at €44.50." }];
  let at = 0;
  const phases: { from: number; attempt: number; doing: LiveFix["doing"]; played?: Played[] }[] = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    phases.push({ from: at, attempt, doing: "writing" });
    at += WRITE_MS;
    phases.push({ from: at, attempt, doing: "building" });
    at += BUILD_MS;
    const last = attempt === attempts;
    const { played, end } = schedule(
      broken.map((s) => ({ name: s.name, script: script(s.name, last ? "passed" : "failed", s.reason), outcome: last ? ("passed" as const) : ("failed" as const) })),
      at,
    );
    phases.push({ from: at, attempt, doing: "checking", played });
    at = end;
  }
  phases.push({ from: at, attempt: attempts, doing: "pushing" });
  const total = at + PUSH_MS + POST_MS;
  if (t > total) return undefined;
  const phase = phases.findLast((p) => p.from <= t) ?? phases[0]!;
  const checked = phases.findLast((p) => p.from <= t && p.played);
  show(checked?.played ?? broken.map((s, i) => ({ id: `s${i}`, name: s.name, script: script(s.name, "failed", s.reason), outcome: "failed" as const, start: Infinity })), t);
  // Before Kane's first re-check the scenarios are as the report left them: broken.
  if (!checked) live.scenarios = live.scenarios.map((s) => ({ ...s, status: "failed" }));
  live.fix = { attempt: phase.attempt, of: 3, doing: phase.doing, ...fixer, tries: phase.attempt > 1 || phase.doing === "pushing" ? tries.slice(0, phase.attempt - 1) : [] };
  return { live, frames: shots };
}

// "Run again", "Fix with Claude" and questions to Kane, by pull request. Two sample pull requests
// are always at work: their runs start over each time they end.
const asked = new Map<string, Ask>([
  [`${sample}/25`, { action: "rerun", at: now - 4000 }],
  [`${sample}/24`, { action: "fix", at: now - 6000 }],
]);
const looping = new Set(asked.keys());

// Answers what the API would, from the data above. Changes (the model, a pause, an ask) live in
// this page's memory only.
export async function demo(path: string, init?: RequestInit): Promise<unknown> {
  await new Promise((done) => setTimeout(done, 150));
  if (path === "/api/try" || path === `/api/pulls/${store}/14`) {
    const sample = await import("./demo-try");
    return path === "/api/try" ? sample.view : sample.detail;
  }
  const ask = /^\/api\/pulls\/(.+\/\d+)\/(fix|rerun|check)$/.exec(path);
  if (ask && init?.method === "POST") {
    const { what } = init.body ? (JSON.parse(String(init.body)) as { what?: string }) : {};
    asked.set(ask[1]!, { action: ask[2]!, at: Date.now(), what });
    looping.delete(ask[1]!);
    return { ok: true };
  }
  const repoAction = /^\/api\/repos\/(.+)\/(pause|resume|fixer|setup)$/.exec(path);
  if (repoAction && init?.method === "POST") {
    const repo = repos.find((r) => r.name === repoAction[1]);
    const action = repoAction[2];
    if (action === "fixer") {
      const fixer = JSON.parse(String(init.body)) as FixerView;
      if (repo) repo.fixer = fixer;
      for (const pull of pulls) if (pull.repo === repo?.name) pull.fixer = fixer;
      return { fixer };
    }
    if (action === "setup") return { skipped: "this is the demo, so no pull request was opened" };
    if (repo) repo.paused = action === "pause";
    return { paused: action === "pause" };
  }
  if (init?.method === "POST") return { ok: true };
  if (path === "/api/me") return me;
  if (path === "/api/repos") return repos.map((r) => ({ ...r }));

  // Each ask's run as it stands now; one that has played out is over, and a fix of the broken sample leaves it fixed.
  const runs = new Map<string, ReturnType<typeof play>>();
  for (const [key, a] of asked) {
    const pull = pulls.find((p) => keyOf(p) === key);
    if (pull && looping.has(key) && !play(pull, a, Date.now() - a.at)) a.at = Date.now();
    const going = pull && play(pull, a, Date.now() - a.at);
    if (going) runs.set(key, going);
    else {
      asked.delete(key);
      if (a.action === "fix" && key === FIXABLE) fixed = true;
    }
  }

  const list = pulls.map((p) => {
    const fixer = repos.find((r) => r.name === p.repo)?.fixer ?? { model: "claude-opus-5-5", effort: "high" };
    return fixed && keyOf(p) === FIXABLE
      ? {
          ...p,
          state: "passing" as const,
          headline: "All 3 affected scenarios pass in a real browser.",
          updatedAt: sampleShipping[0]!.at,
          scenarios: p.scenarios.map((s) => ({ name: s.name, outcome: "passed" as const })),
          fix: { status: "fixed" as const, model: fixer.model, effort: fixer.effort, commit: SAMPLE_FIX, attempts: 2 },
        }
      : p;
  });
  // Pausing a repo in Settings shows on its pull requests, as it does in production.
  const withPause = list.map((p) => {
    const going = runs.get(keyOf(p));
    const state = going ? (going.live.kind === "fix" ? ("fixing" as const) : ("running" as const)) : p.state;
    return { ...p, state, fixer: repos.find((r) => r.name === p.repo)?.fixer ?? undefined, ...(going && { live: summarize(going.live), checking: { sha: going.live.sha, at: going.live.startedAt } }), paused: repos.some((r) => r.name === p.repo && r.paused) };
  });
  if (path === "/api/pulls") return withPause;
  const live = /^\/api\/pulls\/(.+\/\d+)\/live$/.exec(path);
  if (live) {
    const going = runs.get(live[1]!);
    return (going ? { live: { ...going.live, at: Date.now() }, frames: going.frames } : { live: null, frames: {} }) satisfies LiveView;
  }
  const pull = withPause.find((p) => path === `/api/pulls/${p.repo}/${p.pr}`);
  if (!pull) throw new Error("Proofed hasn't reported on that pull request.");
  return { pull, runs: historyOf(pull) } satisfies PullDetail;
}
