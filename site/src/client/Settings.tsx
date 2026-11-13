import { Check, ChevronDown, LoaderCircle, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { MeView, RepoView } from "../worker/api";
import { EFFORTS, modelLabel, MODELS, type Fixer } from "../worker/models";
import type { PullView } from "../worker/runs";
import { api, message, mutate, useLoad } from "./lib";
import { field, focus, link, outline, PageTitle, popover, solid, useDismiss } from "./ui";

// `cancel` is there only when a key is already saved: then closing the form keeps the old one.
type KeyBlockProps = { title: string; connected: string | null; hint: ReactNode; children: (done: () => void, cancel?: ReactNode) => ReactNode };

function KeyBlock({ title, connected, hint, children }: KeyBlockProps) {
  const [editing, setEditing] = useState(!connected);
  useEffect(() => setEditing(!connected), [connected]);
  return (
    <div className="rounded-lg border border-edge bg-panel p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">{title}</h3>
        {connected && !editing && (
          <button type="button" onClick={() => setEditing(true)} className={`${outline} h-7 px-2.5`}>
            Change
          </button>
        )}
      </div>
      {connected && !editing ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-ok">
          <Check size={15} /> {connected}
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-dim">{hint}</p>
          {children(
            () => setEditing(false),
            connected && (
              <button type="button" className={outline} onClick={() => setEditing(false)}>
                Cancel
              </button>
            ),
          )}
        </>
      )}
    </div>
  );
}

function Keys({ me, onSaved }: { me: MeView; onSaved: (message: string) => void }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Fields are read from the form on submit, so a re-render mid-typing can't lose them.
  const save = (fields: Record<string, string>, done: () => void) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const payload = Object.fromEntries(Object.entries(fields).map(([key, name]) => [key, String(data.get(name) ?? "")]));
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ synced: number; of: number }>("/api/keys", { method: "POST", body: JSON.stringify(payload) });
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
        Kane's runs use your TestMu credits and Claude's fixes use your Claude plan. Proofed stores both encrypted and puts them into each
        connected repository's Actions secrets.
      </p>
      {error && <p className="mt-3 rounded-md bg-bad-bg px-3 py-2 text-bad">{error}</p>}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <KeyBlock
          title="TestMu (Kane CLI)"
          connected={me.testmu ? `Connected as ${me.testmu}` : null}
          hint={
            <>
              From the{" "}
              <a href="https://accounts.lambdatest.com/security" className={link}>
                TestMu dashboard
              </a>
              , Settings → Keys.
            </>
          }
        >
          {(done, cancel) => (
            <form className="mt-3 space-y-3" onSubmit={save({ ltUsername: "username", ltAccessKey: "key" }, done)}>
              <label className="block">
                Username
                <input name="username" className={`${field} mt-1`} autoComplete="off" required />
              </label>
              <label className="block">
                Access key
                <input name="key" className={`${field} mt-1`} type="password" autoComplete="off" required />
              </label>
              <div className="flex gap-2">
                <button className={solid} disabled={busy}>
                  {busy ? "Checking…" : "Save"}
                </button>
                {cancel}
              </div>
            </form>
          )}
        </KeyBlock>
        <KeyBlock
          title="Claude Code"
          connected={me.claude ? "Token saved" : null}
          hint={
            <>
              Run <code className="font-mono text-[13px] text-fg">claude setup-token</code> in a terminal and paste the token it prints.
            </>
          }
        >
          {(done, cancel) => (
            <form className="mt-3 space-y-3" onSubmit={save({ claudeToken: "token" }, done)}>
              <label className="block">
                Token
                <input name="token" className={`${field} mt-1`} type="password" autoComplete="off" required />
              </label>
              <div className="flex gap-2">
                <button className={solid} disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </button>
                {cancel}
              </div>
            </form>
          )}
        </KeyBlock>
      </div>
    </section>
  );
}

// A row in the model menu: the same height and weight picked or not, so nothing moves under the mouse.
const menuRow = `flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors hover:bg-hover ${focus}`;

// Which Claude model (and effort) "Fix with Claude" uses in this repo, saved as Actions variables.
// One button in the repo's row; models on the left of the menu, effort on the right.
function FixerMenu({ repo }: { repo: RepoView }) {
  const fixer = repo.fixer;
  const [saving, setSaving] = useState<"model" | "effort">();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(
    open,
    useCallback(() => {
      setOpen(false);
      setTyping(false);
    }, []),
    box,
  );

  if (!fixer) {
    return (
      <a
        href={`https://github.com/settings/installations/${repo.installationId}`}
        className={outline}
        title="Proofed needs a new permission on GitHub to set the model Claude fixes with"
      >
        Allow model choice
      </a>
    );
  }

  const custom = !MODELS.some((m) => m.id === fixer.model);
  const setFixer = (next: Fixer) => mutate<RepoView[]>("/api/repos", (all) => all.map((r) => (r.name === repo.name ? { ...r, fixer: next } : r)));
  const save = async (next: Fixer, what: "model" | "effort") => {
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
    if (model && model !== fixer.model) void save({ ...fixer, model }, "model");
  };
  // The tick on the picked row turns into a spinner while GitHub saves it.
  const tick = (on: boolean, what: "model" | "effort") =>
    on && (saving === what ? <LoaderCircle size={14} className="shrink-0 animate-spin text-faint" /> : <Check size={14} className="shrink-0" />);

  return (
    <div ref={box} className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} title="The model Claude fixes with in this repository" className={outline}>
        {custom ? <span className="max-w-40 truncate font-mono text-[12px]">{fixer.model}</span> : modelLabel(fixer.model)}
        <span className="font-normal text-dim">· {fixer.effort}</span>
        <ChevronDown size={14} className="text-dim" />
      </button>
      {open && (
        <div className={`${popover} w-[min(400px,calc(100vw-48px))] max-sm:left-0 max-sm:right-auto`}>
          <div className="grid grid-cols-[minmax(0,1fr)_128px]">
            <div className="p-1.5">
              <p className="px-2 pb-1 pt-1 text-[12px] font-medium text-faint">Model</p>
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={menuRow}
                  onClick={() => {
                    setTyping(false);
                    if (m.id !== fixer.model) void save({ ...fixer, model: m.id }, "model");
                  }}
                >
                  <span className="flex-1 truncate">{modelLabel(m.id)}</span>
                  {tick(fixer.model === m.id, "model")}
                </button>
              ))}
              {typing ? (
                <form onSubmit={saveOther} className="flex h-8 items-center gap-1 rounded-md bg-hover pl-2 pr-1">
                  <input
                    name="model"
                    aria-label="Model ID"
                    defaultValue={custom ? fixer.model : ""}
                    placeholder="claude-opus-5-1"
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
                <button type="button" className={menuRow} onClick={() => setTyping(true)} title="Any Claude model, by its full ID">
                  <span className={`flex-1 truncate ${custom ? "font-mono text-[12px]" : "text-dim"}`}>{custom ? fixer.model : "Other model ID…"}</span>
                  {tick(custom, "model")}
                </button>
              )}
            </div>
            <div role="radiogroup" aria-label="Effort" className="border-l border-edge p-1.5">
              <p className="px-2 pb-1 pt-1 text-[12px] font-medium text-faint">Effort</p>
              {EFFORTS.map((effort) => (
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
          {error && <p className="border-t border-edge px-3.5 py-2.5 text-[13px] text-bad">{error}</p>}
        </div>
      )}
    </div>
  );
}

const SECRETS = ["LT_USERNAME", "LT_ACCESS_KEY", "CLAUDE_CODE_OAUTH_TOKEN"];

function RepoRow({ repo, me, onChange }: { repo: RepoView; me: MeView; onChange: () => void }) {
  const [busy, setBusy] = useState<string>();
  const [note, setNote] = useState<ReactNode>();
  const keysMissing = SECRETS.some((s) => !repo.secrets.includes(s));
  const haveKeys = !!me.testmu && me.claude;

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
      <button type="button" className={outline} disabled={!!busy} onClick={() => act("setup")}>
        {busy === "setup" ? "Opening a PR…" : "Set up"}
      </button>
    );
  } else if (keysMissing && haveKeys) {
    action = (
      <button type="button" className={outline} disabled={!!busy} onClick={() => act("secrets")} title="Puts your saved keys into this repository's Actions secrets">
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
        <div className="flex flex-wrap items-center gap-2">
          <FixerMenu repo={repo} />
          {action}
          {repo.setup === "active" && (
            <button
              type="button"
              className={outline}
              disabled={!!busy}
              onClick={togglePause}
              title={paused ? "Switches Proofed's workflow back on in this repository" : "Switches Proofed's workflow off on GitHub; nothing in the repository changes"}
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

export function Settings({ me, reloadMe }: { me: MeView; reloadMe: () => void }) {
  const [saved, setSaved] = useState<string>();
  const [saves, setSaves] = useState(0);
  return (
    <main className="mx-auto max-w-6xl px-4 py-5 sm:px-8 sm:py-7">
      <PageTitle>Settings</PageTitle>
      <div className="mt-6 max-w-3xl space-y-10">
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
      </div>
    </main>
  );
}
