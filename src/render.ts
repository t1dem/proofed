// What `proofed check` shows while it runs and when it's done. In a terminal (LiveView): a header,
// one line per scenario redrawn in place, then what broke. Anywhere else (PlainView), for coding
// agents and logs: no escape codes and no redraw, one line per event, a heartbeat at least every 30
// seconds, then the same details. Colour is drawn by hand; there are no runtime dependencies.
import { FAILED_CHECK_REASON } from "./runfile.ts";
import type { RunEvent } from "./run.ts";
import { outcomeOf, type Doc, type ErrorDoc, type Outcome, type ScenarioDoc } from "./result.ts";

export type Stream = { write(s: string): unknown; columns?: number; rows?: number; isTTY?: boolean };

// FORCE_COLOR=0 and NO_COLOR turn colour off, FORCE_COLOR=1 turns it on, even in a pipe.
export function colorOn(env: NodeJS.ProcessEnv, isTTY: boolean) {
  const force = env.FORCE_COLOR;
  if (force !== undefined && force !== "") return !["0", "false"].includes(force.toLowerCase());
  if (env.NO_COLOR) return false;
  return isTTY && env.TERM !== "dumb";
}

export type Palette = ReturnType<typeof palette>;

export function palette(on: boolean) {
  const sgr = (open: number, close: number) => (s: string) => (on && s ? `\x1b[${open}m${s}\x1b[${close}m` : s);
  return {
    bold: sgr(1, 22),
    dim: sgr(2, 22),
    red: sgr(31, 39),
    green: sgr(32, 39),
    yellow: sgr(33, 39),
    magenta: sgr(35, 39),
    cyan: sgr(36, 39),
  };
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const WIDE = /\p{Emoji_Presentation}|[\u1100-\u115f\u2e80-\u303e\u3041-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;
const ZERO = /[\p{Mn}\p{Me}\u200b-\u200f\ufe0f]/u;
const charWidth = (ch: string) => (ZERO.test(ch) ? 0 : WIDE.test(ch) ? 2 : 1);

export const stripAnsi = (s: string) => s.replace(ANSI, "");

// Columns the text takes in a terminal.
export const textWidth = (s: string) => [...stripAnsi(s)].reduce((w, ch) => w + charWidth(ch), 0);

// Cut plain text to `max` columns, ending in … when cut.
export function truncate(s: string, max: number) {
  const flat = s.replace(/[\r\n\t]+/g, " ");
  if (textWidth(flat) <= max) return flat;
  if (max <= 0) return "";
  let out = "";
  let w = 0;
  for (const ch of flat) {
    if (w + charWidth(ch) > max - 1) break;
    out += ch;
    w += charWidth(ch);
  }
  return `${out}…`;
}

export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export const duration = (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`);
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export const credits = (n: number) => n === 0 ? "no credits reported" : `${num(n)} credit${n === 1 ? "" : "s"}`;

// "14:05" today, "Nov 14 14:05" before.
export function since(iso: string, now = Date.now()) {
  const d = new Date(iso);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return new Date(now).toDateString() === d.toDateString() ? hm : `${d.toLocaleString("en", { month: "short" })} ${d.getDate()} ${hm}`;
}

export const GLYPH: Record<Outcome, string> = { passed: "✓", failed: "✗", not_checked: "?", error: "!" };
export const WORD: Record<Outcome, string> = { passed: "passed", failed: "failed", not_checked: "not checked", error: "error" };
const tint = (c: Palette, o: Outcome) => ({ passed: c.green, failed: c.red, not_checked: c.yellow, error: c.magenta })[o];

const NOT_CHECKED = {
  nothing_asserted: 'Kane finished without asserting anything on the page. Make the scenario end in a concrete check ("Check that …").',
  scenario_doubted: "Kane thinks the scenario text is wrong, not the app. Read what it saw, then fix the scenario or the app.",
};

// What a scenario that didn't pass needs explained, label by label.
export function details(d: ScenarioDoc, c: Palette) {
  if (d.outcome === "passed" || d.outcome === "would_run") return [];
  const o = d.outcome;
  const lines = [`${tint(c, o)(GLYPH[o])} ${c.bold(d.name)} ${tint(c, o)(WORD[o])}${d.seconds !== undefined ? c.dim(` after ${clock(d.seconds)}`) : ""}`];
  const field = (label: string, value: string | undefined) => {
    if (!value?.trim()) return;
    const [first, ...rest] = value.trim().split("\n");
    lines.push(`  ${c.dim(label.padEnd(12))}${first}`, ...rest.map((l) => `  ${" ".repeat(12)}${l}`));
  };
  if (d.notChecked) field("Why", NOT_CHECKED[d.notChecked]);
  if (o === "error") field("Why", "Kane couldn't finish the run. It says nothing about the app; run it again.");
  field("Kane saw", d.reason);
  if (d.failedCheck) field("Why", FAILED_CHECK_REASON);
  field(d.failedCheck ? "Kane thinks" : "Diagnosis", d.diagnosis);
  field(d.failedCheck ? "Next" : "Suggestion", d.suggestion);
  field("Failed step", d.failedStep);
  field("Page error", d.pageError);
  field("Clip", d.clip?.mp4 ?? d.clip?.jpg);
  field("Scenario", d.file);
  return lines;
}

// The closing lines: details for what didn't pass, one summary line, the command to re-run.
export function ending(doc: Doc, c: Palette) {
  const lines: string[] = [];
  for (const d of doc.scenarios) {
    const more = details(d, c);
    if (more.length) lines.push("", ...more);
  }
  const { passed, failed, not_checked, error } = doc.counts;
  const parts = [
    passed && c.green(`${passed} passed`),
    failed && c.red(`${failed} failed`),
    not_checked && c.yellow(`${not_checked} not checked`),
    error && c.magenta(`${error} error${error === 1 ? "" : "s"}`),
  ].filter((p): p is string => !!p);
  const glyph = doc.exitCode === 1 ? c.red("✗") : doc.exitCode === 2 ? c.yellow("?") : c.green("✓");
  const tally = parts.length ? parts.join(", ") : doc.summary;
  // Cached passes ran nothing: zero is the whole cost, not a number Kane left out.
  const ranNow = doc.scenarios.some((d) => !d.cached);
  lines.push("", `${glyph} ${c.bold(tally)}${c.dim(` · ${ranNow ? credits(doc.credits) : "0 credits"} · ${duration(doc.seconds)}`)}`);
  if (ranNow) lines.push("Credits are Kane's report; balance may drop slightly more.");
  if (parts.length && doc.exitCode !== 0) lines.push(doc.summary);
  if (doc.rerun) lines.push(`Re-run what broke: ${c.bold(doc.rerun)}`);
  return lines;
}

export type Plan = {
  run: { id: string; name: string }[];
  cached: { id: string; name: string; cachedAt: string }[];
  total: number;
  // Why these: "changes against origin/main", "--only", "your text", "every scenario (not a git repository)".
  selection: string;
  url?: string;
  estimate: number;
  concurrency: number;
  dryRun?: boolean;
};

// "about 1 to 4 minutes per scenario, 3 at a time, so 2 to 8 minutes in all"
export function timing(count: number, concurrency: number) {
  const rounds = Math.ceil(count / Math.max(1, concurrency));
  return `about 1 to 4 minutes per scenario, ${concurrency} at a time, so ${rounds} to ${rounds * 4} minutes in all`;
}

type Row = {
  id: string;
  name: string;
  state: "waiting" | "running" | "done" | "cached";
  startedAt?: number;
  remark?: string;
  retry?: string;
  outcome?: Outcome;
  seconds?: number;
  credits?: number;
  cachedAt?: string;
};

// Where each scenario is, from the run's events.
export class Board {
  rows: Row[];
  constructor(plan: Plan) {
    this.rows = [
      ...plan.cached.map((s): Row => ({ id: s.id, name: s.name, state: "cached", outcome: "passed", cachedAt: s.cachedAt })),
      ...plan.run.map((s): Row => ({ id: s.id, name: s.name, state: "waiting" })),
    ];
  }
  row(id: string) {
    return this.rows.find((r) => r.id === id);
  }
  apply(e: RunEvent, now: number) {
    const row = this.row(e.id);
    if (!row) return;
    if (e.type === "started") Object.assign(row, { state: "running", startedAt: now });
    if (e.type === "step" && e.step.remark) Object.assign(row, { remark: e.step.remark, retry: undefined });
    if (e.type === "retry") Object.assign(row, { retry: e.error, remark: undefined });
    if (e.type === "finished") {
      Object.assign(row, { state: "done", outcome: outcomeOf(e.result), credits: e.result.end?.credits_consumed ?? 0, seconds: e.result.seconds ?? 0 });
    }
  }
  running() {
    return this.rows.filter((r) => r.state === "running");
  }
}

export interface View {
  plan(plan: Plan): void;
  // A line of its own: where the app came from, what was skipped.
  info(line: string): void;
  // A slow step before the scenarios, such as a build.
  phase(line: string): void;
  start(): void;
  event(e: RunEvent): void;
  done(doc: Doc): void;
  fail(doc: ErrorDoc): void;
  // A line of run.log, with --verbose.
  log(line: string): void;
  // Stops drawing and gives the cursor back. Safe to call more than once.
  close(): void;
}

type ViewOptions = { color: boolean; now?: () => number; err?: Stream };

function planLines(p: Plan, c: Palette) {
  const lines = [
    `${c.bold("Proofed")}${p.dryRun ? " (dry run)" : ""}: ${p.dryRun ? "would check" : "checking"} ${p.run.length} of ${p.total} scenario(s), ${p.selection}${p.url ? `, at ${p.url}` : ""}.`,
  ];
  if (p.run.length) lines.push(`Estimate: about ${num(p.estimate)} Kane credits.`);
  if (p.cached.length) lines.push(`Cached passes, 0 credits: ${p.cached.map((s) => s.name).join(", ")}.`);
  return lines;
}

export const errorLines = (doc: ErrorDoc, c: Palette) => [`${c.red("✗")} ${doc.error.message}`, `  ${c.dim("Fix")} ${doc.error.fix}`];

export class PlainView implements View {
  out: Stream;
  err: Stream;
  c: Palette;
  now: () => number;
  heartbeat: number;
  board: Board | undefined;
  started = 0;
  lastLine = 0;
  timer: NodeJS.Timeout | undefined;

  // Progress only: the details, the summary and an error are left to the JSON document.
  brief: boolean;

  constructor(out: Stream, o: ViewOptions & { heartbeat?: number; brief?: boolean }) {
    this.out = out;
    this.err = o.err ?? out;
    this.c = palette(o.color);
    this.now = o.now ?? Date.now;
    this.heartbeat = o.heartbeat ?? 25_000;
    this.brief = o.brief ?? false;
  }
  line(s: string) {
    this.out.write(`${s}\n`);
    this.lastLine = this.now();
  }
  stamp(s: string) {
    this.line(`[${clock(Math.round((this.now() - this.started) / 1000))}] ${s}`);
  }
  plan(p: Plan) {
    this.board = new Board(p);
    for (const l of planLines(p, this.c)) this.line(l);
    if (p.run.length && !p.dryRun) this.line(`Time: ${timing(p.run.length, p.concurrency)}. Do not interrupt: let it finish.`);
  }
  info(s: string) {
    this.line(s);
  }
  phase(s: string) {
    this.line(s);
  }
  start() {
    this.started = this.lastLine = this.now();
    this.timer = setInterval(() => this.tick(), 1000);
  }
  tick() {
    if (!this.board || this.now() - this.lastLine < this.heartbeat) return;
    const at = (r: Row) => clock(Math.round((this.now() - (r.startedAt ?? this.started)) / 1000));
    const running = this.board.running().map((r) => `${r.id} ${at(r)}${r.remark ? ` at "${truncate(r.remark, 80)}"` : ""}`);
    const waiting = this.board.rows.filter((r) => r.state === "waiting").map((r) => r.id);
    this.stamp(
      `still running: ${running.join("; ") || "starting Chrome"}${waiting.length ? `. Waiting: ${waiting.join(", ")}` : ""}`,
    );
  }
  event(e: RunEvent) {
    const row = this.board?.row(e.id);
    this.board?.apply(e, this.now());
    if (!row) return;
    if (e.type === "started") this.stamp(`started ${row.id}: ${row.name}`);
    if (e.type === "retry") this.stamp(`retrying ${row.id}: ${truncate(e.error, 160)}`);
    if (e.type === "finished" && row.outcome) {
      this.stamp(`${tint(this.c, row.outcome)(WORD[row.outcome])} ${row.id}: ${row.name} (${clock(row.seconds ?? 0)}, ${credits(row.credits ?? 0)})`);
    }
  }
  done(doc: Doc) {
    this.close();
    if (!this.brief) for (const l of ending(doc, this.c)) this.line(l);
  }
  fail(doc: ErrorDoc) {
    this.close();
    if (!this.brief) for (const l of errorLines(doc, this.c)) this.err.write(`${l}\n`);
  }
  log(s: string) {
    this.err.write(`${s}\n`);
  }
  close() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";

export class LiveView implements View {
  out: Stream;
  err: Stream;
  c: Palette;
  now: () => number;
  board: Board | undefined;
  phaseText: string | undefined;
  phaseAt = 0;
  // Columns of each line last drawn, to know how many rows to go back up after a resize.
  drawn: number[] = [];
  timer: NodeJS.Timeout | undefined;
  hidden = false;
  settled = false;
  // The scenario rows show from start() on: a build that fails before it has no rows to leave behind.
  started = false;
  // After stop() nothing is drawn again: a late resize would otherwise erase the closing lines.
  closed = false;

  constructor(out: Stream, o: ViewOptions) {
    this.out = out;
    this.err = o.err ?? out;
    this.c = palette(o.color);
    this.now = o.now ?? Date.now;
  }
  width() {
    return Math.max(20, this.out.columns || 80);
  }
  plan(p: Plan) {
    this.board = new Board(p);
    const c = this.c;
    const parts = [
      `${p.dryRun ? "dry run: " : ""}${p.run.length} of ${p.total} scenario${p.total === 1 ? "" : "s"}`,
      ...(p.run.length ? [`~${num(p.estimate)} credits`] : []),
      p.selection,
      ...(p.url ? [p.url] : []),
    ];
    this.print(`${c.bold("proofed")}  ${truncate(parts.join(" · "), this.width() - 10)}`);
    if (p.run.length && !p.dryRun) this.print(c.dim(truncate(timing(p.run.length, p.concurrency), this.width() - 1)));
  }
  // Also ends a phase: what it printed is its outcome.
  info(s: string) {
    this.phaseText = undefined;
    this.print(this.c.dim(truncate(s, this.width() - 1)));
  }
  phase(s: string) {
    this.phaseText = s;
    this.phaseAt = this.now();
    this.animate();
  }
  start() {
    this.phaseText = undefined;
    this.started = true;
    this.animate();
  }
  event(e: RunEvent) {
    this.board?.apply(e, this.now());
    if (e.type === "finished") this.draw();
  }
  done(doc: Doc) {
    this.settled = true;
    this.draw();
    this.stop();
    for (const l of ending(doc, this.c)) this.out.write(`${l}\n`);
  }
  fail(doc: ErrorDoc) {
    this.phaseText = undefined;
    this.draw();
    this.stop();
    for (const l of errorLines(doc, this.c)) this.err.write(`${l}\n`);
  }
  log(s: string) {
    this.erase();
    this.err.write(`${this.c.dim(s)}\n`);
    this.draw();
  }
  close() {
    this.stop();
  }

  // A line above the live block.
  print(s: string) {
    this.erase();
    this.out.write(`${s}\n`);
    this.draw();
  }
  animate() {
    if (!this.hidden) {
      this.out.write(HIDE);
      this.hidden = true;
    }
    this.timer ??= setInterval(() => this.draw(), 80);
    this.draw();
  }
  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.hidden) this.out.write(SHOW);
    this.hidden = false;
    this.closed = true;
    this.drawn = [];
  }
  // Back to the top of the block and clear to the end of the screen. A line drawn wider than the
  // terminal is now (it shrank) has wrapped, so it takes more than one row.
  erase() {
    const cols = this.out.columns || 80;
    const up = this.drawn.reduce((n, w) => n + Math.max(1, Math.ceil(w / cols)), 0);
    if (up) this.out.write(`\x1b[${up}F\x1b[J`);
    this.drawn = [];
  }
  draw() {
    if (this.closed) return;
    const lines = this.lines();
    this.erase();
    if (!lines.length) return;
    this.out.write(`${lines.join("\n")}\n`);
    this.drawn = lines.map(textWidth);
  }
  lines(): string[] {
    const c = this.c;
    const w = this.width() - 1;
    const spin = SPINNER[Math.floor(this.now() / 80) % SPINNER.length]!;
    if (this.phaseText !== undefined) {
      const t = clock(Math.round((this.now() - this.phaseAt) / 1000));
      return [`${c.cyan(spin)} ${truncate(this.phaseText, w - t.length - 4)}  ${c.dim(t)}`];
    }
    if (!this.board || (!this.started && !this.settled)) return [];
    let rows = this.board.rows;
    // Taller than the terminal: redrawing would scroll. The running ones stay, the rest are counted.
    const room = Math.max(3, (this.out.rows || 24) - 2);
    let rest = "";
    if (rows.length > room) {
      const keep = rows.filter((r) => r.state === "running").slice(0, room - 1);
      const other = rows.filter((r) => !keep.includes(r));
      const n = (s: Row["state"]) => other.filter((r) => r.state === s).length;
      rest = c.dim(truncate(`  … ${n("done") + n("cached")} done, ${n("waiting")} waiting`, w));
      rows = keep;
    }
    return [...rows.map((r) => this.rowLine(r, w, spin)), ...(rest ? [rest] : [])];
  }
  rowLine(r: Row, w: number, spin: string) {
    const c = this.c;
    const name = (room: number) => truncate(r.name, Math.max(8, Math.min(room, Math.floor(w * 0.5))));
    if (r.state === "waiting") return c.dim(truncate(`· ${r.name}  waiting`, w));
    if (r.state === "cached") {
      const n = name(w - 2);
      return `${c.green("✓")} ${n}  ${c.dim(truncate(`cached, unchanged since ${since(r.cachedAt ?? "", this.now())}`, w - 4 - textWidth(n)))}`;
    }
    if (r.state === "done" && r.outcome) {
      const n = name(w - 2);
      const tail = truncate(`${clock(r.seconds ?? 0)} · ${credits(r.credits ?? 0)}`, w - 4 - textWidth(n));
      return `${tint(c, r.outcome)(GLYPH[r.outcome])} ${n}  ${c.dim(tail)}`;
    }
    const t = clock(Math.round((this.now() - (r.startedAt ?? this.now())) / 1000));
    const n = name(w - 4 - t.length);
    const room = w - 2 - textWidth(n) - 2 - t.length - 2;
    const said = r.retry ? `retrying: ${r.retry}` : (r.remark ?? "starting Chrome");
    const remark = room >= 6 ? `  ${(r.retry ? c.yellow : c.dim)(truncate(said, room))}` : "";
    return `${c.cyan(spin)} ${c.bold(n)}  ${t}${remark}`;
  }
}
