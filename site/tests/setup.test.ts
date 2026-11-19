import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { test, type TestContext } from "node:test";
import { FIRST_ANDROID_SCENARIO, FIRST_SCENARIO } from "../../src/action/setup.ts";

const source = new URL("../src/", import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith(".") && context.parentURL?.startsWith(source) && !extname(specifier) ? specifier + ".ts" : specifier, context);
  },
});
const { openSetupPr } = await import("../src/worker/setup.ts");
hook.deregister();

async function setup(t: TestContext, files: Record<string, string>) {
  const blobs: Record<string, string> = {};
  let body = "";
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname.replace(/^\/repos\/fixture\/app\//, "");
    if (path.startsWith("contents/")) {
      const content = files[path.slice("contents/".length)];
      return content === undefined ? new Response(null, { status: 404 }) : Response.json({ content: btoa(content) });
    }
    if (path === "git/ref/heads/main") return Response.json({ object: { sha: "head" } });
    if (path === "git/trees/head") return Response.json({ tree: Object.keys(files).map((path) => ({ path, type: "blob" })) });
    if (path === "git/commits/head") return Response.json({ tree: { sha: "base" } });
    assert.equal(init.method, "POST");
    const payload = JSON.parse(String(init.body));
    if (path === "git/trees") {
      for (const file of payload.tree) blobs[file.path] = file.content;
      return Response.json({ sha: "tree" });
    }
    if (path === "git/commits") return Response.json({ sha: "setup" });
    if (path === "git/refs") return Response.json({});
    assert.equal(path, "pulls");
    body = payload.body;
    return Response.json({ html_url: "https://example.test/pull/1" });
  });
  assert.deepEqual(await openSetupPr("fixture-token", { full_name: "fixture/app", default_branch: "main" }, "proofed"), {
    pr: "https://example.test/pull/1",
  });
  return { workflow: blobs[".github/workflows/proofed.yml"]!, scenario: blobs[".proofed/scenarios/home.md"], body };
}

test("an Android application gets the Ubuntu cloud workflow and Android starter scenario", async (t) => {
  const { workflow, scenario, body } = await setup(t, {
    "package.json": '{"scripts":{"lint":"eslint ."}}',
    "settings.gradle.kts": 'include(":app")',
    "gradlew": "",
    "app/build.gradle.kts": 'plugins { id("com.android.application") } // do not use apply false here',
  });
  assert.match(workflow, /^    runs-on: ubuntu-latest$/m);
  assert.match(workflow, /      - uses: actions\/setup-java@v4\n        with:\n          distribution: temurin\n          java-version: '17'\n      - uses: android-actions\/setup-android@v3/);
  assert.match(workflow, /          target: android\n          execution: cloud\n          build: \.\/gradlew :app:assembleDebug\n          app: app\/build\/outputs\/apk\/debug\/app-debug\.apk\n          device: Pixel 8\n          os-version: '14'/);
  assert.doesNotMatch(workflow, /^          (url|serve|install):/m);
  assert.equal(scenario, FIRST_ANDROID_SCENARIO);
  assert.match(body, /Android application module `:app` with Temurin Java 17/);
  assert.match(body, /conventional debug output path `app\/build\/outputs\/apk\/debug\/app-debug\.apk`/);
  assert.match(body, /requires a TestMu plan with real devices\. End-to-end setup is not yet verified on a real device plan/);
  assert.match(body, /Add keys to repo/);
  assert.match(body, /including \x60CODEX_API_KEY\x60 for Codex, before rerunning the setup check/);
});

test("Android detection skips libraries and unapplied plugins and reads the Gradle Java toolchain", async (t) => {
  const { workflow } = await setup(t, {
    "settings.gradle": 'include ":app", ":template", ":apps:phone"',
    "gradlew": "",
    "app/build.gradle": "plugins { id 'com.android.library' }",
    "template/build.gradle": "plugins { id 'com.android.application' version '8.9.0' apply false }",
    "gradle/libs.versions.toml": '[plugins]\nandroid-app = { id = "com.android.application", version.ref = "agp" }',
    "apps/phone/build.gradle": "plugins { alias(libs.plugins.android.app) }",
    "build.gradle": "java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }",
  });
  assert.match(workflow, /java-version: '21'/);
  assert.match(workflow, /build: \.\/gradlew :apps:phone:assembleDebug/);
  assert.match(workflow, /app: apps\/phone\/build\/outputs\/apk\/debug\/phone-debug\.apk/);
});

test("a servable web package takes precedence over an Android application", async (t) => {
  const { workflow, scenario, body } = await setup(t, {
    "settings.gradle": 'include ":app"',
    "app/build.gradle": "apply plugin: 'com.android.application'",
    "site/package.json": '{"scripts":{"build":"vite build","preview":"vite preview"}}',
    "package-lock.json": "{}",
  });
  assert.match(workflow, /          url: http:\/\/localhost:4173\n          working-directory: site\n          install: npm install\n          build: npm run build\n          serve: npm run preview --port 4173/);
  assert.doesNotMatch(workflow, /^          cache:/m);
  assert.doesNotMatch(workflow, /setup-java|target: android/);
  assert.equal(scenario, FIRST_SCENARIO);
  assert.match(body, /checks every pull request in Chrome/);
});

test("an npm workspace with a leading slash uses the root lockfile", async (t) => {
  const { workflow } = await setup(t, {
    "package.json": '{"workspaces":["/apps/*/"]}',
    "apps/web/package.json": '{"scripts":{"start":"node server.js"}}',
    "package-lock.json": "{}",
  });
  assert.match(workflow, /          working-directory: apps\/web\n          install: npm ci/);
  assert.match(workflow, /^          cache: npm$/m);
});

test("a nested app excluded by the workspace uses its own install", async (t) => {
  const { workflow } = await setup(t, {
    "package.json": '{"workspaces":{"packages":["./apps/*","!/apps/web"]}}',
    "apps/web/package.json": '{"scripts":{"start":"node server.js"}}',
    "package-lock.json": "{}",
  });
  assert.match(workflow, /          working-directory: apps\/web\n          install: npm install/);
  assert.doesNotMatch(workflow, /^          cache:/m);
});

test("a Gradle library keeps the static web fallback", async (t) => {
  const { workflow, scenario } = await setup(t, {
    "settings.gradle.kts": 'include(":app")',
    "app/build.gradle.kts": '// id("com.android.application")\nplugins { id("com.android.library") }',
  });
  assert.match(workflow, /serve: npx --yes serve@14 -l 4173 \./);
  assert.doesNotMatch(workflow, /target: android/);
  assert.equal(scenario, FIRST_SCENARIO);
});
