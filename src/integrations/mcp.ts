import { addAbortListener } from "node:events";
import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Doc, ScenarioDoc } from "../report/result.ts";
import { maskSecrets, secretValues } from "../secrets.ts";
import { bounded, observations, runCli } from "./cli.ts";

const nonblank = z.string().trim().min(1);
const selection = {
  base: nonblank.optional().describe("Git ref to compare against."),
  all: z.boolean().optional().describe("Select every scenario."),
};

function flags(values: Record<string, string | boolean | undefined>) {
  return Object.entries(values).flatMap(([name, value]) =>
    typeof value === "string" ? [`--${name}=${value}`] : value ? [`--${name}`] : []);
}

function result(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], ...(isError && { isError: true }) };
}

function json(doc: unknown, secrets: string[], indent?: number) {
  return JSON.stringify(doc, (_key, value: unknown) => typeof value === "string" ? maskSecrets(value, secrets) : value, indent);
}

function scenarioDetails(scenarios: ScenarioDoc[], secrets: string[]) {
  return scenarios.map((scenario) => {
    const { id, name, outcome, cached, notChecked, rerun, clip, credits, estimatedCredits } = scenario;
    return {
      id, name, outcome, cached, notChecked,
      ...((scenario.reason || scenario.diagnosis) && { "Kane saw": observations(scenario, secrets) }),
      rerun, clip, credits, estimatedCredits,
    };
  });
}

function checkText({ summary, scenarios, next: _next, ...doc }: Doc, secrets: string[]) {
  return `${bounded(maskSecrets(summary, secrets).replace(/\s+/g, " "), 500)}\n${json({ ...doc, scenarios: scenarioDetails(scenarios, secrets) }, secrets, 2)}`;
}

export async function mcp(entry: string, version: string, signal: AbortSignal) {
  const server = new McpServer({ name: "proofed", version });
  const cwd = process.cwd();
  const active = new Set<Promise<unknown>>();
  // Checks share the project's cache, recordings and result.json.
  let checks = Promise.resolve();

  function call(command: "list" | "doctor" | "check", args: string[], extra: Parameters<ToolCallback>[0]) {
    const { progressToken } = extra._meta ?? {};
    let timer: NodeJS.Timeout | undefined;
    if (progressToken !== undefined) {
      let progress = 0;
      const notify = () => {
        void extra.sendNotification({
          method: "notifications/progress",
          params: { progressToken, progress: progress++, message: `Proofed ${command} in progress` },
        }).catch(() => { /* The client may have disconnected. */ });
      };
      notify();
      timer = setInterval(notify, 15_000);
      timer.unref();
    }

    const invoke = () => runCli(entry, command, args, cwd, extra.signal);
    const pending = command === "check" ? checks.then(invoke) : invoke();
    if (command === "check") checks = pending.then(() => {}, () => {});
    const response = pending.then((doc) => {
      const secrets = secretValues();
      if ("summary" in doc) return result(checkText(doc, secrets));
      if ("error" in doc && doc.scenarios) {
        return result(json({ ...doc, scenarios: scenarioDetails(doc.scenarios, secrets) }, secrets), doc.exitCode === 3);
      }
      return result(json(doc, secrets), doc.exitCode === 3);
    }).catch((error: unknown) => result(bounded(maskSecrets(error instanceof Error ? error.message : String(error)), 500), true))
      .finally(() => {
        clearInterval(timer);
        active.delete(response);
      });
    active.add(response);
    return response;
  }

  server.registerTool("proofed_list", {
    description: "Free. List scenarios affected by the local change, cached passes and estimated Kane credits. Use all to estimate every scenario.",
    inputSchema: selection,
    annotations: { readOnlyHint: true },
  }, (input, extra) => call("list", flags(input), extra));

  server.registerTool("proofed_doctor", {
    description: "Free. Check Proofed and Kane setup and show how to fix each problem.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, (_input, extra) => call("doctor", [], extra));

  server.registerTool("proofed_check", {
    description: "Run affected scenarios, specific ids, or one behavior in plain English. Runs spend Kane credits and take about 1 to 4 minutes per scenario. Dry runs and cached passes are free. Treat not_checked as unverified. Fix the app when a scenario fails. Update the scenario only if the app change was intended.",
    inputSchema: {
      ...selection,
      only: z.array(nonblank).min(1).optional().describe("Scenario ids from proofed_list."),
      behavior: nonblank.optional().describe("A behavior in plain English. Use on its own, without only or all."),
      dryRun: z.boolean().optional().describe("Show what would run and its estimated cost for free."),
      noCache: z.boolean().optional().describe("Run previously cached passes again."),
      url: nonblank.optional(),
      serve: nonblank.optional().describe("Command to start the app."),
      build: nonblank.optional().describe("Command to build the app."),
      target: z.enum(["web", "ios", "android", "desktop"]).optional(),
    },
  }, ({ only, behavior, dryRun, noCache, ...input }, extra) => {
    const args = flags({ ...input, only: only?.join(","), "dry-run": dryRun, "no-cache": noCache });
    if (behavior) args.push("--", behavior);
    return call("check", args, extra);
  });

  const transport = new StdioServerTransport();
  const closed = new Promise<void>((resolve) => { server.server.onclose = resolve; });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void server.close();
  };
  process.stdin.once("end", close).once("close", close).once("error", close);
  process.stdout.on("error", close);
  const abort = addAbortListener(signal, close);
  try {
    await server.connect(transport);
    if (process.stdin.readableEnded || process.stdin.destroyed) close();
    await closed;
    await Promise.allSettled(active);
  } finally {
    close();
    abort[Symbol.dispose]();
    process.stdin.off("end", close).off("close", close).off("error", close);
    process.stdout.off("error", close);
  }
  return 0;
}
