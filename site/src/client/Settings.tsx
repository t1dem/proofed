import { Check, Pause, Play } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { MeView, RepoView } from "../worker/api";
import { EFFORTS, modelLabel, MODELS, type Fixer } from "../worker/models";
import { api, message, useLoad } from "./lib";
import { field, link, outline, PageTitle, Segmented, solid } from "./ui";

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

const OTHER = "other";
const modelOptions = [...MODELS.map((m) => ({ value: m.id as string, label: modelLabel(m.id) })), { value: OTHER, label: "Other…" }];
const effortOptions = EFFORTS.map((e) => ({ value: e as string, label: e }));

const Labelled = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid gap-1.5 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center sm:gap-3">
    <span className="text-[13px] text-dim">{label}</span>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);

// Which Claude model (and effort) "Fix with Claude" uses in this repo. Saved as Actions variables.
function FixerChoice({ repo }: { repo: RepoView }) {
  const [fixer, setFixer] = useState(repo.fixer);
  const [state, setState] = useState<ReactNode>();
  // A model that isn't in the list was typed in as a full ID; show it in the field.
  const [other, setOther] = useState(() => !!repo.fixer && !MODELS.some((m) => m.id === repo.fixer?.model));

  if (!fixer) {
    return (
      <p className="text-[13px] text-dim">
        To choose the model Claude fixes with,{" "}
        <a href={`https://github.com/settings/installations/${repo.installationId}`} className={`${link} text-fg`}>
          accept Proofed's new permission on GitHub
        </a>
        .
      </p>
    );
  }

  const save = async (next: Fixer) => {
    const before = fixer;
    setFixer(next);
    setState("Saving…");
    try {
      await api(`/api/repos/${repo.name}/fixer`, { method: "POST", body: JSON.stringify(next) });
      setState("Saved");
    } catch (e) {
      setFixer(before);
      setState(<span className="text-bad">{message(e)}</span>);
    }
  };

  const pickModel = (value: string) => {
    if (value === OTHER) return setOther(true);
    setOther(false);
    void save({ ...fixer, model: value });
  };
  const saveOther = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const model = String(new FormData(e.currentTarget).get("model") ?? "").trim();
    if (model && model !== fixer.model) void save({ ...fixer, model });
  };

  return (
    <div className="space-y-2.5">
      <Labelled label="Claude model">
        <Segmented label="Model" value={other ? OTHER : fixer.model} options={modelOptions} onChange={pickModel} />
        {state && <span className="text-[13px] text-faint">{state}</span>}
      </Labelled>
      {other && (
        <Labelled label="Model ID">
          <form onSubmit={saveOther} className="flex items-center gap-2">
            <input
              name="model"
              aria-label="Model ID"
              defaultValue={MODELS.some((m) => m.id === fixer.model) ? "" : fixer.model}
              placeholder="claude-opus-5-1"
              className={`${field} h-8 w-52`}
              autoComplete="off"
              spellCheck={false}
              required
            />
            <button className={outline}>Save</button>
          </form>
        </Labelled>
      )}
      <Labelled label="Effort">
        <Segmented label="Effort" value={fixer.effort} options={effortOptions} onChange={(effort) => save({ ...fixer, effort })} />
      </Labelled>
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
    <li className="space-y-4 p-4">
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
        <div className="flex items-center gap-2">
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
      <FixerChoice repo={repo} />
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
