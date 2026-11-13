import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { MeView, RepoView } from "../worker/api";
import { EFFORTS, modelLabel, MODELS, type Fixer } from "../worker/models";

type Load<T> = { status: "loading" } | { status: "signed-out" } | { status: "error"; message: string } | { status: "ok"; data: T };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) throw new SignedOut();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}
class SignedOut extends Error {}

function useLoad<T>(path: string) {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const reload = useCallback(() => {
    api<T>(path).then(
      (data) => setState({ status: "ok", data }),
      (e: unknown) =>
        setState(e instanceof SignedOut ? { status: "signed-out" } : { status: "error", message: e instanceof Error ? e.message : String(e) }),
    );
  }, [path]);
  useEffect(reload, [reload]);
  return [state, reload] as const;
}

const button = "inline-flex min-h-11 items-center justify-center rounded-full px-5 font-medium transition disabled:opacity-50";
const primary = `${button} bg-ink text-paper hover:bg-ink/85`;
const secondary = `${button} border border-ink/25 hover:border-ink`;
const input = "mt-1.5 min-h-11 w-full rounded-lg border border-line bg-white px-3 font-mono text-[15px] outline-none focus:border-ink";

function SignIn() {
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-xl flex-col justify-center px-4">
      <h1 className="font-serif text-5xl leading-tight">Sign in to Proofed</h1>
      <p className="mt-4 text-lg leading-relaxed text-ink/85">
        With your GitHub account. Proofed only sees the repositories you install it on.
      </p>
      <a href="/login" className={`${primary} mt-8 self-start`}>
        Sign in with GitHub
      </a>
    </main>
  );
}

function TopBar({ me }: { me: MeView }) {
  return (
    <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-8">
      <a href="/" className="font-serif text-2xl">
        Proofed
      </a>
      <div className="flex items-center gap-3 text-[15px]">
        {me.avatar && <img src={me.avatar} alt="" className="size-8 rounded-full" />}
        <span className="hidden sm:inline">{me.login}</span>
        <a href="/logout" className="text-muted hover:text-ink hover:underline">
          Sign out
        </a>
      </div>
    </header>
  );
}

function KeyBlock({
  title,
  connected,
  hint,
  children,
}: {
  title: string;
  connected: string | null;
  hint: ReactNode;
  children: (done: () => void) => ReactNode;
}) {
  const [editing, setEditing] = useState(!connected);
  useEffect(() => setEditing(!connected), [connected]);
  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">{title}</h3>
        {connected && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-[15px] text-muted hover:text-ink hover:underline">
            Change
          </button>
        )}
      </div>
      {connected && !editing ? (
        <p className="mt-2 text-pass">✓ {connected}</p>
      ) : (
        <>
          <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{hint}</p>
          {children(() => setEditing(false))}
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
    const payload = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, String(data.get(field) ?? "")]));
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ synced: number; of: number }>("/api/keys", { method: "POST", body: JSON.stringify(payload) });
      done();
      onSaved(r.of > 0 ? `Saved, and added to ${r.synced} of ${r.of} repositories.` : "Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 className="font-serif text-3xl">Your keys</h2>
      <p className="mt-2 max-w-2xl text-ink/85">
        Kane's runs use your TestMu credits and Claude's fixes use your Claude plan. Proofed stores both encrypted and puts them
        into each connected repository's Actions secrets.
      </p>
      {error && <p className="mt-4 rounded-lg bg-fail-bg px-4 py-3 text-fail">{error}</p>}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <KeyBlock
          title="TestMu (Kane CLI)"
          connected={me.testmu ? `Connected as ${me.testmu}` : null}
          hint={
            <>
              From the{" "}
              <a href="https://accounts.lambdatest.com/security" className="underline underline-offset-4">
                TestMu dashboard
              </a>
              , Settings → Keys.
            </>
          }
        >
          {(done) => (
            <form className="mt-4 space-y-3" onSubmit={save({ ltUsername: "username", ltAccessKey: "key" }, done)}>
              <label className="block text-[15px]">
                Username
                <input name="username" className={input} autoComplete="off" required />
              </label>
              <label className="block text-[15px]">
                Access key
                <input name="key" className={input} type="password" autoComplete="off" required />
              </label>
              <button className={primary} disabled={busy}>
                {busy ? "Checking…" : "Save"}
              </button>
            </form>
          )}
        </KeyBlock>
        <KeyBlock
          title="Claude Code"
          connected={me.claude ? "Token saved" : null}
          hint={
            <>
              Run <code className="font-mono text-ink">claude setup-token</code> in a terminal and paste the token it prints.
            </>
          }
        >
          {(done) => (
            <form className="mt-4 space-y-3" onSubmit={save({ claudeToken: "token" }, done)}>
              <label className="block text-[15px]">
                Token
                <input name="token" className={input} type="password" autoComplete="off" required />
              </label>
              <button className={primary} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </form>
          )}
        </KeyBlock>
      </div>
    </section>
  );
}

const stateText: Record<string, { mark: string; className: string }> = {
  failing: { mark: "✗", className: "text-fail" },
  passing: { mark: "✓", className: "text-pass" },
  fixing: { mark: "…", className: "text-ink" },
  blocked: { mark: "!", className: "text-muted" },
};

function ago(ts: number) {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function RepoRow({ repo, me, onChange }: { repo: RepoView; me: MeView; onChange: () => void }) {
  const [busy, setBusy] = useState<string>();
  const [note, setNote] = useState<ReactNode>();
  const missing = ["LT_USERNAME", "LT_ACCESS_KEY", "CLAUDE_CODE_OAUTH_TOKEN"].filter((s) => !repo.secrets.includes(s));
  const haveKeys = !!me.testmu && me.claude;

  const act = async (action: "setup" | "secrets") => {
    setBusy(action);
    setNote(undefined);
    try {
      const r = await api<{ pr?: string; skipped?: string; pushed?: string[] }>(`/api/repos/${repo.name}/${action}`, { method: "POST" });
      if (r.pr)
        setNote(
          <>
            Setup PR opened.{" "}
            <a href={r.pr} className="underline underline-offset-4">
              Review and merge it
            </a>
            .
          </>,
        );
      else if (r.skipped) setNote(`Nothing to do: ${r.skipped}.`);
      else if (r.pushed) setNote(`Added ${r.pushed.length} secrets.`);
      onChange();
    } catch (e) {
      setNote(<span className="text-fail">{e instanceof Error ? e.message : String(e)}</span>);
    } finally {
      setBusy(undefined);
    }
  };

  const report = repo.report && stateText[repo.report.state];

  return (
    <li className="py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <a href={repo.url} className="font-mono text-[17px] hover:underline">
          {repo.name}
        </a>
        <span className="text-[15px] text-muted">{repo.private ? "Private" : "Public"}</span>
      </div>

      <div className="mt-3 grid gap-2 text-[15px] sm:grid-cols-2">
        <p>
          {repo.setup === "active" ? (
            <span className="text-pass">✓ Checks every pull request</span>
          ) : repo.setup === "pr-open" ? (
            <>
              Setup PR is open.{" "}
              <a href={repo.setupPr} className="underline underline-offset-4">
                Merge it to start
              </a>
            </>
          ) : (
            <button type="button" className={secondary} disabled={!!busy} onClick={() => act("setup")}>
              {busy === "setup" ? "Opening a PR…" : "Set up this repository"}
            </button>
          )}
        </p>
        <p>
          {missing.length === 0 ? (
            <span className="text-pass">✓ Keys in place</span>
          ) : haveKeys ? (
            <button type="button" className={secondary} disabled={!!busy} onClick={() => act("secrets")}>
              {busy === "secrets" ? "Adding…" : "Add your keys"}
            </button>
          ) : (
            <span className="text-muted">Keys missing. Save them above first.</span>
          )}
        </p>
      </div>

      <FixerChoice repo={repo} />

      {repo.report && report && (
        <p className="mt-3 text-[15px]">
          <span className={`${report.className} mr-2 font-semibold`}>{report.mark}</span>
          <a href={repo.report.url} className="hover:underline">
            PR #{repo.report.pr}: {repo.report.headline}
          </a>{" "}
          <span className="text-muted">· {ago(repo.report.updatedAt)}</span>
        </p>
      )}
      {note && <p className="mt-3 text-[15px]">{note}</p>}
    </li>
  );
}

const EXACT = "exact";

// Which Claude model (and effort) "Fix with Claude" uses in this repo. Saved as Actions variables.
function FixerChoice({ repo }: { repo: RepoView }) {
  const [fixer, setFixer] = useState(repo.fixer);
  const [state, setState] = useState<ReactNode>();
  // A model that isn't in the list was typed in as a full ID; show it in the field.
  const [exact, setExact] = useState(() => !!repo.fixer && !MODELS.some((m) => m.id === repo.fixer?.model));

  if (!fixer) {
    return (
      <p className="mt-3 text-[15px] text-muted">
        To choose the model Claude fixes with,{" "}
        <a href={`https://github.com/settings/installations/${repo.installationId}`} className="text-ink underline underline-offset-4">
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
      setState(<span className="text-fail">{e instanceof Error ? e.message : String(e)}</span>);
    }
  };

  const pickModel = (value: string) => {
    if (value === EXACT) return setExact(true);
    setExact(false);
    void save({ ...fixer, model: value });
  };
  const saveExact = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const model = String(new FormData(e.currentTarget).get("model") ?? "").trim();
    if (model && model !== fixer.model) void save({ ...fixer, model });
  };

  const select = "min-h-11 rounded-lg border border-line bg-white px-2 text-[15px] outline-none focus:border-ink";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px]">
      <span>Claude fixes with</span>
      <select aria-label="Model" className={select} value={exact ? EXACT : fixer.model} onChange={(e) => pickModel(e.target.value)}>
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {modelLabel(m.id)}
          </option>
        ))}
        <option value={EXACT}>Exact model ID…</option>
      </select>
      {exact && (
        <form onSubmit={saveExact} className="flex items-center gap-2">
          <input
            name="model"
            aria-label="Model ID"
            defaultValue={MODELS.some((m) => m.id === fixer.model) ? "" : fixer.model}
            placeholder="claude-opus-5-1"
            className={`${select} w-52 font-mono`}
            autoComplete="off"
            spellCheck={false}
            required
          />
          <button className={secondary}>Save</button>
        </form>
      )}
      <select aria-label="Effort" className={select} value={fixer.effort} onChange={(e) => save({ ...fixer, effort: e.target.value })}>
        {EFFORTS.map((e) => (
          <option key={e} value={e}>
            {e} effort
          </option>
        ))}
      </select>
      {state && <span className="text-muted">{state}</span>}
    </div>
  );
}

function Repos({ me }: { me: MeView }) {
  const [repos, reload] = useLoad<RepoView[]>("/api/repos");
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="font-serif text-3xl">Repositories</h2>
        <a href={me.installUrl} className={secondary}>
          Add repositories
        </a>
      </div>
      {repos.status === "loading" && <p className="mt-6 text-muted">Loading your repositories…</p>}
      {repos.status === "error" && <p className="mt-6 text-fail">{repos.message}</p>}
      {repos.status === "ok" &&
        (repos.data.length === 0 ? (
          <div className="mt-6 rounded-xl border border-line bg-card p-6">
            <p>Proofed isn't on any of your repositories yet.</p>
            <a href={me.installUrl} className={`${primary} mt-4`}>
              Install on GitHub
            </a>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {repos.data.map((r) => (
              <RepoRow key={r.name} repo={r} me={me} onChange={reload} />
            ))}
          </ul>
        ))}
    </section>
  );
}

export function Dashboard() {
  const [me, reloadMe] = useLoad<MeView>("/api/me");
  const [message, setMessage] = useState<string>();
  const [saves, setSaves] = useState(0);

  if (me.status === "loading") return <p className="p-8 text-muted">Loading…</p>;
  if (me.status === "signed-out") return <SignIn />;
  if (me.status === "error") return <p className="p-8 text-fail">{me.message}</p>;

  return (
    <>
      <TopBar me={me.data} />
      <main className="mx-auto max-w-5xl space-y-16 px-4 pb-24 pt-6 sm:px-8">
        <div>
          <h1 className="font-serif text-4xl sm:text-5xl">Hi, {me.data.login}.</h1>
          {message && <p className="mt-4 rounded-lg bg-pass-bg px-4 py-3 text-pass">{message}</p>}
        </div>
        <Keys
          me={me.data}
          onSaved={(m) => {
            setMessage(m);
            setSaves((n) => n + 1);
            reloadMe();
          }}
        />
        {/* Remount after a key save so the secrets status is read again. */}
        <Repos key={saves} me={me.data} />
      </main>
    </>
  );
}
