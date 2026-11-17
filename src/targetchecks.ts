import { executableCommand } from "./process.ts";
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { promisify } from "node:util";
import type { Target } from "./target.ts";

const exec = promisify(execFile);
export type TargetCheck = { name: string; status: "ok" | "warn" | "fail"; detail: string; fix: string };
export const kaneTarget = (target: Target) => target.kind === "ios" ? (target.execution === "local" ? "simulator" : "ios") : target.kind === "android" ? (target.execution === "local" ? "emulator" : "android") : "desktop";

export async function command(bin: string, args: string[], env = process.env) {
  try {
    const cmd = executableCommand(bin, args, env);
    const { stdout, stderr } = await exec(cmd.file, cmd.args, { env, windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, text: `${stdout}\n${stderr}`.trim() };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, text: `${e.stdout ?? ""}\n${e.stderr ?? e.message ?? "Command failed"}`.trim() };
  }
}

export async function renderer(endpoint: string) {
  const version = await fetch(new URL("/json/version", endpoint), { signal: AbortSignal.timeout(1500) });
  if (!version.ok || !(await version.json() as { webSocketDebuggerUrl?: string }).webSocketDebuggerUrl) throw new Error("CDP /json/version has no browser websocket");
  const response = await fetch(new URL("/json/list", endpoint), { signal: AbortSignal.timeout(1500) });
  const pages = (await response.json() as { id: string; type: string; url: string }[]).filter((p) => p.type === "page");
  if (pages.length !== 1) throw new Error(`Expected one page renderer, found ${pages.length}`);
  return pages[0]!;
}

export async function localDevice(target: Extract<Target, { kind: "ios" | "android" }>, env = process.env) {
  if (!target.device || !target.os_version) throw new Error("Local mobile requires device and os_version");
  if (target.kind === "ios") {
    const result = await command("xcrun", ["simctl", "list", "devices", "available", "--json"], env);
    if (!result.ok) throw new Error(result.text);
    const data = JSON.parse(result.text) as { devices: Record<string, { name: string; udid: string; state: string }[]> };
    const matches = Object.entries(data.devices).filter(([runtime]) => runtime.endsWith(`iOS-${target.os_version!.replaceAll(".", "-")}`)).flatMap(([, devices]) => devices).filter((d) => d.name === target.device && d.state === "Booted");
    if (matches.length !== 1) throw new Error(`Expected one booted ${target.device} iOS ${target.os_version}, found ${matches.length}`);
    return matches[0]!.udid;
  }
  const devices = await command("adb", ["devices"], env);
  if (!devices.ok) throw new Error(devices.text);
  const matches: string[] = [];
  for (const line of devices.text.split("\n")) {
    const serial = /^(\S+)\s+device$/.exec(line)?.[1];
    if (!serial) continue;
    const name = await command("adb", ["-s", serial, "emu", "avd", "name"], env);
    const model = await command("adb", ["-s", serial, "shell", "getprop", "ro.product.model"], env);
    const os = await command("adb", ["-s", serial, "shell", "getprop", "ro.build.version.release"], env);
    if ((name.text.split("\n")[0] === target.device || model.text === target.device) && os.text === target.os_version) matches.push(serial);
  }
  if (matches.length !== 1) throw new Error(`Expected one online ${target.device} Android ${target.os_version}, found ${matches.length}`);
  return matches[0]!;
}

export async function targetChecks(target: Target, options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; pendingBuild?: boolean; launchPending?: boolean } = {}): Promise<TargetCheck[]> {
  const env = options.env ?? process.env;
  const checks: TargetCheck[] = [];
  const add = (name: string, ok: boolean, detail: string, fix: string) => checks.push({ name, status: ok ? "ok" : "fail", detail, fix });
  if (target.kind === "web") return checks;
  if (target.kind === "desktop") {
    if (!target.cdp_endpoint) add("Desktop CDP", false, "No cdp_endpoint", "Set --cdp-endpoint http://127.0.0.1:<port> and --launch, or --reuse for an existing app.");
    else {
      try { const page = await renderer(target.cdp_endpoint); add("Desktop CDP", true, `Experimental Electron renderer: ${page.url}`, "Keep exactly one page renderer."); }
      catch (e) { checks.push({ name: "Desktop CDP", status: target.launch && options.launchPending ? "ok" : "fail", detail: target.launch && options.launchPending ? `not running, as expected: proofed check launches it (${String(e)})` : String(e), fix: target.launch ? "proofed check will launch the app; doctor never launches it." : "Start the app with remote debugging and exactly one page renderer." }); }
    }
    if (!target.launch && !target.reuse) add("Desktop ownership", false, "Existing endpoints require --reuse", "Pass --reuse; Proofed will not close the existing app.");
    return checks;
  }
  const app = target.app;
  const validType = !!app && (/^APP[\w-]+$/.test(app) || (target.kind === "ios" ? (target.execution === "local" ? /\.(app|zip)$/i : /\.ipa$/i) : (target.execution === "local" ? /\.apk$/i : /\.(apk|aab)$/i)).test(app));
  add("App artifact type", validType, app ?? "No app artifact", `Set --app to ${target.kind === "ios" ? target.execution === "local" ? "a simulator .app or .zip" : "a device .ipa" : target.execution === "local" ? "an .apk" : "an .apk or .aab"}, or an APP ID.`);
  if (app && !/^APP[\w-]+$/.test(app)) {
    const present = existsSync(app) && (app.endsWith(".app") ? statSync(app).isDirectory() : statSync(app).isFile());
    checks.push({ name: "App artifact", status: present || options.pendingBuild ? "ok" : "fail", detail: present ? app : options.pendingBuild ? `artifact_pending_build: proofed check builds ${app} first` : `Missing ${app}`, fix: "Build the app before running the check." });
  }
  if (target.execution === "cloud") {
    checks.push({ name: "Cloud recording", status: "ok", detail: "screenshots only, no video clip; local execution records MP4", fix: "Use local execution for MP4 recording." });
    return checks;
  }
  if (target.kind === "ios" && (options.platform ?? process.platform) !== "darwin") {
    add("iOS host", false, "Local iOS simulators require macOS and Xcode", "Use a Mac for local iOS, or select cloud execution with a device .ipa.");
    return checks;
  }
  if (target.kind === "ios") {
    for (const [name, bin, args] of [["Xcode", "xcodebuild", ["-version"]], ["simctl", "xcrun", ["simctl", "list", "devices", "available", "--json"]]] as const) {
      const result = await command(bin, [...args], env);
      add(name, result.ok, result.text, "Install full Xcode and a matching iOS runtime; select Xcode with xcode-select. Doctor never installs or boots devices.");
    }
  }
  const deps = await command(env.KANE_CLI ?? "kane-cli", ["doctor", "--target", kaneTarget(target)], env);
  add("Kane managed mobile dependencies", deps.ok && !/[✗✘]|not installed|not found/i.test(deps.text), deps.text, `Run kane-cli doctor --target ${kaneTarget(target)} and explicitly set up the listed managed dependencies before check.`);
  try { const id = await localDevice(target, env); add("Recording device", true, id, "Keep this device online and booted."); }
  catch (e) { add("Recording device", false, String(e), "Set --device and --os-version to exactly one booted simulator or online emulator; boot it yourself."); }
  return checks;
}
