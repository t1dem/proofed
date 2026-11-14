// What the Proofed setup PR (site/src/worker/setup.ts) writes, so the action can tell that PR apart
// and see whether its scenarios are still the stock one. Also imported by the dashboard's worker,
// so this file has no imports and nothing Node-specific.
export const SETUP_BRANCH = "proofed-setup";

export const FIRST_SCENARIO = `---
name: Home page loads
url: /
---
Open the home page. Check that the main heading is visible and that the page shows no error message.
`;

// The scenarios folder holds the stock scenario and nothing else: no one has written one yet.
export const onlyFirstScenario = (files: { name: string; text?: string }[]) =>
  files.length === 1 && files[0]!.name === "home.md" && files[0]!.text === FIRST_SCENARIO;
