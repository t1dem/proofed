// The landing's showcase (PullShowcase) and the demo share the sample store's failed and fixed
// scenarios. Kept apart from demo.ts so the landing doesn't pull the whole demo dataset — and the
// demo-try data it sits on — into its first load.
import type { RunScenario } from "../worker/runs";

// The sample store. `at` is where each step starts in /clips/fail.mp4.
export const shippingSteps = [
  { remark: "Opened the store. The note under the headline says “Free shipping from €0.50”", at: 0 },
  { remark: "Added House Espresso to the bag", at: 0.8 },
  { remark: "Added Paper Filters to the bag", at: 2.6 },
  { remark: "Opened the bag", at: 3.8 },
  { remark: "Checked shipping: Free at €44.50, where €4.90 was expected", failed: true, at: 5.5 },
];

export const sampleFix: RunScenario = { id: "free-shipping", name: "Free shipping from €50", outcome: "passed", reason: "Shipping is €4.90 at €49.40 and Free at €51.00.", clip: { mp4: "/clips/fixed.mp4", jpg: "/clips/fixed.jpg" }, credits: 27, seconds: 41 };

export const sampleFail: RunScenario = {
  id: "free-shipping",
  name: "Free shipping from €50",
  outcome: "failed",
  reason: "Shipping is Free at €44.50, and the store says “Free shipping from €0.50”. Expected €4.90 below €50.",
  diagnosis: "The threshold is now written as 50, in euros, but the cart still counts in cents: every order ships free.",
  steps: shippingSteps,
  clip: { mp4: "/clips/fail.mp4", jpg: "/clips/fail.jpg" },
  credits: 26,
  seconds: 38,
};
