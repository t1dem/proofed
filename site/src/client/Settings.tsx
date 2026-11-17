import { Check, ChevronDown, LoaderCircle, LogOut, Moon, Pause, Play, Sun, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { FixerView, MeView, RepoView } from "../worker/api";
import { defaultModel, effortsFor, modelLabel, MODELS, PROVIDERS, providerLabel, providerOf } from "../worker/models";
import type { PullDetail, PullView } from "../worker/runs";
import type { Theme } from "./App";
import { api, DEMO, message, mutate, useLoad } from "./lib";
import { Avatar, Backdrop, field, focus, link, NEEDS_WRITE, outline, PageTitle, popover, soft, solid, useDismiss, useSheetDrag } from "./ui";

// The services' own marks: TestMu's "T" in the text colour, the fixer's spark in its orange.
const TestMuMark = () => (
  <svg viewBox="0 0 18.02 20.27" width="16" height="18" fill="currentColor" aria-hidden="true">
    <path d="M18.0137 0H12.6097V13.0595H18.0137V0Z" />
    <path d="M5.4043 0H0.000360489V7.43041L5.4043 13.0595V0Z" />
    <path d="M5.4043 13.0595H0.000360489V20.2648H5.4043V13.0595Z" />
    <path d="M12.6104 13.0595H5.4051L9.68322 18.4634H12.6104V13.0595Z" />
  </svg>
);

const ClaudeMark = () => (
  <svg viewBox="0 0 248 248" width="22" height="22" fill="#D97757" aria-hidden="true">
    <path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" />
  </svg>
);

const CodexMark = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
    {[0, 60, 120, 180, 240, 300].map((angle) => (
      <path key={angle} transform={`rotate(${angle} 12 12)`} d="M12 3.2a4.5 4.5 0 0 1 7.3 4.6l-7.3 4.3-3.8-2.2V5.6L12 3.4v8.7" />
    ))}
  </svg>
);

type KeyBlockProps = {
  title: string;
  className?: string;
  sub?: string;
  mark: ReactNode;
  connected: ReactNode;
  hint: ReactNode;
  busy: boolean;
  busyLabel: string;
  onSave: (e: FormEvent<HTMLFormElement>, done: () => void) => void;
  // The inputs, placeholder-labelled: the tile has no room for labels above them.
  fields: ReactNode;
};

// One tile that is either the saved key or the form to change it. Both are drawn in the same grid cell,
// so the tile is as tall as the taller of the two and switching never moves anything on the page.
function KeyBlock({ title, className = "", sub, mark, connected, hint, busy, busyLabel, onSave, fields }: KeyBlockProps) {
  // A boolean, not `connected` itself: that's a new element on every render, and the page re-renders
  // as it polls, which would close the form under the user's hands.
  const saved = !!connected;
  const [editing, setEditing] = useState(!saved);
  useEffect(() => setEditing(!saved), [saved]);
  const form = useRef<HTMLFormElement>(null);
  const cancel = () => {
    form.current?.reset();
    setEditing(false);
  };
  // Change puts the cursor in the first field (it's in the DOM all along, only hidden).
  useEffect(() => {
    if (editing && saved) form.current?.querySelector("input")?.focus();
  }, [editing, saved]);

  const name = (
    <h3 className="text-[15px] font-semibold">
      {title} {sub && <span className="font-normal text-faint">{sub}</span>}
    </h3>
  );
  const layer = (shown: boolean) => `[grid-area:1/1] transition-opacity duration-200 ${shown ? "opacity-100" : "invisible opacity-0"}`;

  return (
    <div className={`grid rounded-xl border border-edge bg-panel p-5 ${className}`}>
      <div className={`flex flex-col ${layer(!editing)}`} aria-hidden={editing}>
        <div className="flex items-start justify-between gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-hover text-fg">{mark}</span>
          <button type="button" onClick={() => setEditing(true)} className={outline}>
            Change
          </button>
        </div>
        <div className="mt-auto pt-4">
          {name}
          <p className="mt-1 flex items-center gap-2 text-[13px] text-dim">
            <span className="size-2 shrink-0 rounded-full bg-ok" />
            <span className="truncate">{connected}</span>
          </p>
        </div>
      </div>

      <form ref={form} onSubmit={(e) => onSave(e, () => setEditing(false))} className={`flex flex-col ${layer(editing)}`} aria-hidden={!editing}>
        {/* The same h-8 box in the same corner as Change, so the two swap in place. */}
        <div className="flex items-center justify-between gap-3">
          {name}
          {connected && (
            <button type="button" onClick={cancel} aria-label="Cancel" title="Cancel" className={`inline-grid size-8 shrink-0 place-items-center rounded-md border border-edge text-dim transition-colors hover:bg-hover hover:text-fg ${focus}`}>
              <X size={16} />
            </button>
          )}
        </div>
        <p className="mt-1 text-[13px] text-dim">{hint}</p>
        <div className="mt-auto flex gap-2 pt-4">
          {fields}
          <button className={solid} disabled={busy}>
            {busy ? busyLabel : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// h-8, not the usual h-9: level with the Save button next to them.
const keyField = `${field.replace("h-9", "h-8")} min-w-0 flex-1 text-fg placeholder:font-sans placeholder:text-faint`;

function Keys({ me, onSaved }: { me: MeView; onSaved: (message: string) => void }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Fields are read from the form on submit, so a re-render mid-typing can't lose them.
  const save = (fields: Record<string, string>) => async (e: FormEvent<HTMLFormElement>, done: () => void) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const data = new FormData(formEl);
    const payload = Object.fromEntries(Object.entries(fields).map(([key, name]) => [key, String(data.get(name) ?? "")]));
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ synced: number; of: number }>("/api/keys", { method: "POST", body: JSON.stringify(payload) });
      formEl.reset();
      done();
      onSaved(r.of > 0 ? `Saved, and added to ${r.synced} of ${r.of} repositories.` : "Saved.");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 className="font-semibold">Your keys</h2>
      <p className="mt-1 max-w-2xl text-dim">
        Kane uses your TestMu credits. Fixes use your Claude plan or OpenAI API key. Proofed stores keys encrypted and puts them into each
        connected repository's Actions secrets.
      </p>
      {error && <p className="mt-3 rounded-md bg-bad-bg px-3 py-2 text-bad">{error}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <KeyBlock
          title="TestMu"
          className="sm:col-span-2"
          sub="Kane CLI"
          mark={<TestMuMark />}
          connected={
            me.testmu ? (
              <span>
                Connected as <span className="font-medium text-fg">{me.testmu}</span>
              </span>
            ) : null
          }
          hint={
            <>
              From the{" "}
              <a href="https://accounts.lambdatest.com/security" className={link}>
                TestMu dashboard
              </a>
              , Settings → Keys.
            </>
          }
          busy={busy}
          busyLabel="Checking…"
          onSave={save({ ltUsername: "username", ltAccessKey: "key" })}
          fields={
            <>
              <input name="username" aria-label="Username" placeholder="Username" className={keyField} autoComplete="off" required />
              <input name="key" aria-label="Access key" placeholder="Access key" className={keyField} type="password" autoComplete="off" required />
            </>
          }
        />
        <KeyBlock
          title="Claude Code"
          mark={<ClaudeMark />}
          connected={me.claude ? "Token saved" : null}
          hint={
            <>
              Run <code className="font-mono text-[12px] text-fg">claude setup-token</code> and paste the token.
            </>
          }
          busy={busy}
          busyLabel="Saving…"
          onSave={save({ claudeToken: "token" })}
          fields={<input name="token" aria-label="Token" placeholder="Token" className={keyField} type="password" autoComplete="off" required />}
        />
        <KeyBlock
          title="Codex"
          sub="OpenAI"
          mark={<CodexMark />}
          connected={me.codex ? "API key saved" : null}
          hint={<>An API key from <a href="https://platform.openai.com/api-keys" className={link}>OpenAI</a>. API usage is billed to your OpenAI account.</>}
          busy={busy}
          busyLabel="Saving…"
          onSave={save({ codexKey: "key" })}
          fields={<input name="key" aria-label="OpenAI API key" placeholder="API key" className={keyField} type="password" autoComplete="off" required />}
        />
      </div>
    </section>
  );
}

// A row in the model menu: the same height and weight picked or not, so nothing moves under the mouse.
const menuRow = `flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] ${soft} hover:bg-hover active:bg-hover max-md:h-11 max-md:text-[15px] ${focus}`;

// The provider, model and effort used in this repo, and whether it fixes on its own,
// saved as Actions variables. One button in the repo's row; models on the left of the menu, effort on
// the right, the switch for fixing automatically under both.
function FixerMenu({ repo }: { repo: RepoView }) {
  const fixer = repo.fixer;
  const [saving, setSaving] = useState<"model" | "effort" | "auto">();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setTyping(false);
  }, []);
  useDismiss(open, close, box);
  const sheet = useSheetDrag(close);

  if (!fixer) {
    return (
      <a
        href={`https://github.com/settings/installations/${repo.installationId}`}
        className={outline}
        title="Proofed needs a new permission on GitHub to set the fixer model"
      >
        Allow model choice
      </a>
    );
  }

  const provider = providerOf(fixer.model);
  const providerName = providerLabel(provider);
  const custom = !MODELS.some((m) => m.id === fixer.model);
  const setFixer = (next: FixerView) => {
    mutate<RepoView[]>("/api/repos", (all) => all.map((r) => (r.name === repo.name ? { ...r, fixer: next } : r)));
    mutate<PullView[]>("/api/pulls", (all) => all.map((p) => {
      if (p.repo !== repo.name) return p;
      mutate<PullDetail>(`/api/pulls/${p.repo}/${p.pr}`, (detail) => ({ ...detail, pull: { ...detail.pull, fixer: next } }));
      return { ...p, fixer: next };
    }));
  };
  const save = async (next: FixerView, what: "model" | "effort" | "auto") => {
    setFixer(next);
    setSaving(what);
    setError(undefined);
    try {
      await api(`/api/repos/${repo.name}/fixer`, { method: "POST", body: JSON.stringify(next) });
    } catch (e) {
      setFixer(fixer);
      setError(message(e));
    } finally {
      setSaving(undefined);
    }
  };
  const saveOther = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const model = String(new FormData(e.currentTarget).get("model") ?? "").trim().toLowerCase();
    setTyping(false);
    if (model && model !== fixer.model) void save({ ...fixer, provider: providerOf(model), model, effort: effortsFor(model).some((e) => e === fixer.effort) ? fixer.effort : "high" }, "model");
  };
  // The tick on the picked row turns into a spinner while GitHub saves it.
  const tick = (on: boolean, what: "model" | "effort") =>
    on && (saving === what ? <LoaderCircle size={14} className="shrink-0 animate-spin text-faint" /> : <Check size={14} className="shrink-0" />);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        disabled={repo.access === "read"}
        onClick={() => setOpen(!open)}
        title={repo.access === "read" ? NEEDS_WRITE : "The model that fixes this repository"}
        className={`${outline} max-md:w-full`}
      >
        {custom ? <span className="max-w-40 truncate font-mono text-[12px]">{fixer.model}</span> : modelLabel(fixer.model)}
        <span className="font-normal text-dim">· {fixer.effort}</span>
        <ChevronDown size={14} className="text-dim" />
      </button>
      {open && (
        <>
        <Backdrop onClose={close} />
        <div ref={sheet} className={`${popover} w-[min(460px,calc(100vw-48px))]`}>
          <div className="grid grid-cols-[48px_minmax(0,1fr)_120px] max-md:grid-cols-[48px_minmax(0,1fr)_104px]">
            <div role="tablist" aria-label="Provider" className="flex flex-col items-center gap-1 border-r border-edge py-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-label={providerLabel(p)}
                  aria-selected={provider === p}
                  title={providerLabel(p)}
                  onClick={() => {
                    setTyping(false);
                    if (p !== providerOf(fixer.model)) {
                      const model = defaultModel(p);
                      void save({ ...fixer, provider: p, model, effort: effortsFor(model).some((e) => e === fixer.effort) ? fixer.effort : "high" }, "model");
                    }
                  }}
                  className={`relative grid size-11 place-items-center rounded-md text-dim hover:bg-hover hover:text-fg ${focus} ${provider === p ? "text-fg before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-work" : ""}`}
                >
                  {p === "claude" ? <ClaudeMark /> : <CodexMark />}
                </button>
              ))}
            </div>
            <div className="min-w-0 p-1.5">
              <p className="px-2 pb-1 pt-1 text-[12px] font-medium text-faint">Model</p>
              {MODELS.filter((m) => m.provider === provider).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={menuRow}
                  onClick={() => {
                    setTyping(false);
                    if (m.id !== fixer.model) void save({ ...fixer, provider: m.provider, model: m.id, effort: m.efforts.some((e) => e === fixer.effort) ? fixer.effort : "high" }, "model");
                  }}
                >
                  <span className="flex-1 truncate">{modelLabel(m.id)}</span>
                  {tick(fixer.model === m.id, "model")}
                </button>
              ))}
              {provider === "claude" && (typing ? (
                <form onSubmit={saveOther} className="flex h-8 items-center gap-1 rounded-md bg-hover pl-2 pr-1">
                  <input
                    name="model"
                    aria-label="Model ID"
                    defaultValue={custom ? fixer.model : ""}
                    placeholder={defaultModel(provider)}
                    className="h-full min-w-0 flex-1 bg-transparent font-mono text-[12px] outline-none placeholder:text-faint"
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    required
                    onKeyDown={(e) => {
                      // Escape leaves the field, not the whole menu.
                      if (e.key !== "Escape") return;
                      e.stopPropagation();
                      setTyping(false);
                    }}
                  />
                  <button className={`h-6 shrink-0 rounded px-2 text-[12px] font-medium text-bg transition-colors bg-fg hover:bg-fg/85 ${focus}`}>Save</button>
                </form>
              ) : (
                <button type="button" className={menuRow} onClick={() => setTyping(true)} title="A full model ID">
                  <span className={`flex-1 truncate ${custom ? "font-mono text-[12px]" : "text-dim"}`}>{custom ? fixer.model : "Other model ID…"}</span>
                  {tick(custom, "model")}
                </button>
              ))}
            </div>
            <div role="radiogroup" aria-label="Effort" className="border-l border-edge p-1.5">
              <p className="px-2 pb-1 pt-1 text-[12px] font-medium text-faint">Effort</p>
              {effortsFor(fixer.model).map((effort) => (
                <button
                  key={effort}
                  type="button"
                  role="radio"
                  aria-checked={fixer.effort === effort}
                  className={menuRow}
                  onClick={() => effort !== fixer.effort && save({ ...fixer, effort }, "effort")}
                >
                  <span className="flex-1">{effort}</span>
                  {tick(fixer.effort === effort, "effort")}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-edge p-1.5 max-md:px-2">
            <button
              type="button"
              role="switch"
              aria-checked={fixer.auto}
              disabled={saving === "auto"}
              onClick={() => save({ ...fixer, auto: !fixer.auto }, "auto")}
              className={`flex w-full items-start gap-3 rounded-md px-2 py-2 text-left ${soft} hover:bg-hover active:bg-hover ${focus}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] max-md:text-[15px]">Fix automatically</span>
                <span className="mt-0.5 block text-[12px] text-faint max-md:text-[13px]">
                  When Kane sees a scenario fail, {providerName} starts a fix right away. Not on drafts, or when the test may be wrong.
                </span>
              </span>
              <span className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${fixer.auto ? "bg-work" : "bg-edge"}`}>
                <span className={`absolute top-0.5 size-4 rounded-full bg-fg transition-[left] ${fixer.auto ? "left-[18px]" : "left-0.5"}`} />
              </span>
            </button>
          </div>
          {error && <p className="border-t border-edge px-3.5 py-2.5 text-[13px] text-bad">{error}</p>}
        </div>
        </>
      )}
    </div>
  );
}

const SECRETS = ["LT_USERNAME", "LT_ACCESS_KEY"];

function RepoRow({ repo, me, onChange }: { repo: RepoView; me: MeView; onChange: () => void }) {
  const [busy, setBusy] = useState<string>();
  const [note, setNote] = useState<ReactNode>();
  const provider = providerOf(repo.fixer?.model ?? "");
  const secret = provider === "codex" ? "CODEX_API_KEY" : "CLAUDE_CODE_OAUTH_TOKEN";
  const keysMissing = [...SECRETS, secret].some((s) => !repo.secrets.includes(s));
  const haveKeys = !!me.testmu && (provider === "codex" ? me.codex : me.claude);
  const readOnly = repo.access === "read";

  const [paused, setPaused] = useState(repo.paused);
  useEffect(() => setPaused(repo.paused), [repo.paused]);

  const togglePause = async () => {
    const action = paused ? "resume" : "pause";
    setBusy(action);
    setNote(undefined);
    try {
      const r = await api<{ paused: boolean }>(`/api/repos/${repo.name}/${action}`, { method: "POST" });
      setPaused(r.paused);
      // The inbox and this list open on their cached copies; keep both in step.
      mutate<RepoView[]>("/api/repos", (all) => all.map((x) => (x.name === repo.name ? { ...x, paused: r.paused } : x)));
      mutate<PullView[]>("/api/pulls", (all) => all.map((p) => (p.repo === repo.name ? { ...p, paused: r.paused } : p)));
    } catch (e) {
      setNote(<span className="text-bad">{message(e)}</span>);
    } finally {
      setBusy(undefined);
    }
  };

  const act = async (action: "setup" | "secrets") => {
    setBusy(action);
    setNote(undefined);
    try {
      const r = await api<{ pr?: string; skipped?: string; pushed?: string[] }>(`/api/repos/${repo.name}/${action}`, { method: "POST" });
      if (r.pr)
        setNote(
          <>
            Setup PR opened.{" "}
            <a href={r.pr} className={link}>
              Review and merge it
            </a>
            .
          </>,
        );
      else if (r.skipped) setNote(`Nothing to do: ${r.skipped}.`);
      else if (r.pushed) setNote(`Added ${r.pushed.length} secrets.`);
      onChange();
    } catch (e) {
      setNote(<span className="text-bad">{message(e)}</span>);
    } finally {
      setBusy(undefined);
    }
  };

  // One line on where the repository stands, and the one thing to do next.
  const setupSays =
    repo.setup === "active"
      ? paused
        ? "Paused: pull requests aren't checked and /proofed isn't answered"
        : repo.fixer?.auto
          ? "Checks every pull request and fixes what breaks"
          : "Checks every pull request"
      : repo.setup === "pr-open"
        ? "Setup PR is open"
        : "Not set up";
  const keysSays = keysMissing ? (haveKeys ? "your keys aren't in its secrets yet" : "keys missing: save them above first") : undefined;
  const ready = repo.setup === "active" && !keysMissing;
  const dot = repo.setup === "none" || paused ? "bg-faint" : ready ? "bg-ok" : "bg-busy";

  let action: ReactNode = null;
  if (repo.setup === "none") {
    action = (
      <button type="button" className={outline} disabled={!!busy || readOnly} title={readOnly ? NEEDS_WRITE : undefined} onClick={() => act("setup")}>
        {busy === "setup" ? "Opening a PR…" : "Set up"}
      </button>
    );
  } else if (keysMissing && haveKeys) {
    action = (
      <button
        type="button"
        className={outline}
        disabled={!!busy || repo.access !== "admin"}
        onClick={() => act("secrets")}
        title={repo.access === "admin" ? "Puts your saved keys into this repository's Actions secrets" : "Needs admin access to this repository"}
      >
        {busy === "secrets" ? "Adding…" : "Add keys to repo"}
      </button>
    );
  } else if (repo.setup === "pr-open") {
    action = (
      <a href={repo.setupPr} className={outline}>
        Merge setup PR
      </a>
    );
  }

  return (
    <li className="space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="mr-auto min-w-0">
          <a href={repo.url} className="font-medium hover:underline">
            {repo.name}
          </a>
          <p className="mt-0.5 flex items-center gap-2 text-[13px] text-dim">
            <span className={`size-2 shrink-0 rounded-full ${dot}`} />
            <span>
              {setupSays}
              {keysSays && `, ${keysSays}`}
            </span>
          </p>
        </div>
        {/* On a phone, two equal columns across the row; a third button takes a row of its own. */}
        <div className="flex flex-wrap items-center gap-2 max-md:grid max-md:w-full max-md:grid-cols-2 max-md:*:w-full max-md:[&>*:nth-child(3)]:col-span-2">
          <FixerMenu repo={repo} />
          {action}
          {repo.setup === "active" && (
            <button
              type="button"
              className={outline}
              disabled={!!busy || readOnly}
              onClick={togglePause}
              title={readOnly ? NEEDS_WRITE : paused ? "Switches Proofed's workflow back on in this repository" : "Switches Proofed's workflow off on GitHub; nothing in the repository changes"}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
              {busy === "pause" ? "Pausing…" : busy === "resume" ? "Resuming…" : paused ? "Resume" : "Pause"}
            </button>
          )}
        </div>
      </div>
      {note && <p className="text-[13px]">{note}</p>}
    </li>
  );
}

function Repos({ me }: { me: MeView }) {
  const [repos, reload] = useLoad<RepoView[]>("/api/repos");
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Repositories</h2>
        <a href={me.installUrl} className={outline}>
          Add repositories
        </a>
      </div>
      {repos.status === "loading" && <p className="mt-4 text-faint">Loading your repositories…</p>}
      {repos.status === "error" && <p className="mt-4 text-bad">{repos.message}</p>}
      {repos.status === "ok" &&
        (repos.data.length === 0 ? (
          <div className="mt-4 rounded-lg border border-edge bg-panel p-4">
            <p>Proofed isn't on any of your repositories yet.</p>
            <a href={me.installUrl} className={`${solid} mt-3`}>
              Install on GitHub
            </a>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-edge rounded-lg border border-edge bg-panel">
            {repos.data.map((r) => (
              <RepoRow key={r.name} repo={r} me={me} onChange={reload} />
            ))}
          </ul>
        ))}
    </section>
  );
}

// On a phone there's no sidebar: the theme and the account live here, at the end.
function PhoneApp({ me, theme, onTheme }: { me: MeView; theme: Theme; onTheme: () => void }) {
  const ThemeIcon = theme === "dark" ? Moon : Sun;
  return (
    <section className="md:hidden">
      <h2 className="font-semibold">App</h2>
      <ul className="mt-3 divide-y divide-edge rounded-xl border border-edge bg-panel">
        <li>
          <button type="button" onClick={onTheme} className={`flex h-12 w-full items-center gap-3 px-4 text-left ${focus}`}>
            <ThemeIcon size={18} className="shrink-0 text-dim" />
            <span className="flex-1">Theme</span>
            <span className="text-dim">{theme === "dark" ? "Dark" : "Light"}</span>
          </button>
        </li>
        <li className="flex h-14 items-center gap-3 px-4">
          <Avatar me={me} />
          {/* The demo's account is made up; signing out from it would sign out whoever is really signed in. */}
          <span className="min-w-0 flex-1 truncate">{DEMO ? "Demo on sample data" : me.login}</span>
          <a href={DEMO ? "/app" : "/logout"} className={outline}>
            <LogOut size={14} />
            {DEMO ? "Leave the demo" : "Sign out"}
          </a>
        </li>
      </ul>
    </section>
  );
}

export function Settings({ me, reloadMe, theme, onTheme }: { me: MeView; reloadMe: () => void; theme: Theme; onTheme: () => void }) {
  const [saved, setSaved] = useState<string>();
  const [saves, setSaves] = useState(0);
  return (
    <main className="mx-auto max-w-3xl px-4 pb-8 sm:px-8 md:py-7">
      <PageTitle>Settings</PageTitle>
      <div className="mt-6 space-y-10">
        {saved && <p className="rounded-md bg-ok-bg px-3 py-2 text-ok">{saved}</p>}
        <Keys
          me={me}
          onSaved={(text) => {
            setSaved(text);
            setSaves((n) => n + 1);
            reloadMe();
          }}
        />
        {/* Remount after a key save so the secrets status is read again. */}
        <Repos key={saves} me={me} />
        <PhoneApp me={me} theme={theme} onTheme={onTheme} />
      </div>
    </main>
  );
}
