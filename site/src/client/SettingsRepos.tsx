import { LoaderCircle, Pause, Play } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { MeView, RepoView } from "../worker/api";
import { providerOf } from "../worker/models";
import type { PullView } from "../worker/runs";
import { api, message, mutate, useLoad } from "./lib";
import { FixerMenu } from "./SettingsFixerMenu";
import { iconButton, link, NEEDS_WRITE, outline, RepoChip, solid, subtle } from "./ui";

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
      mutate<RepoView[]>("/api/repos", (all) => all.map((x) => (x.name === repo.name ? { ...x, paused: r.paused } : x)), { preserveDuringRefresh: true });
      mutate<PullView[]>("/api/pulls", (all) => all.map((p) => (p.repo === repo.name ? { ...p, paused: r.paused } : p)), { preserveDuringRefresh: true });
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
      const r = await api<{ pr?: string; skipped?: string; pushed?: string[]; warning?: string }>(`/api/repos/${repo.name}/${action}`, { method: "POST" });
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
      else if (r.pushed) {
        const added = `Added ${r.pushed.length} secrets.`;
        setNote(r.warning ? `${added} ${r.warning}` : added);
      }
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
      <button type="button" className={subtle} disabled={!!busy || readOnly} title={readOnly ? NEEDS_WRITE : undefined} onClick={() => act("setup")}>
        {busy === "setup" ? "Opening a PR…" : "Set up"}
      </button>
    );
  } else if (keysMissing && haveKeys) {
    action = (
      <button
        type="button"
        className={subtle}
        disabled={!!busy || repo.access !== "admin"}
        onClick={() => act("secrets")}
        title={repo.access === "admin" ? "Puts your saved keys into this repository's Actions secrets" : "Needs admin access to this repository"}
      >
        {busy === "secrets" ? "Adding…" : "Add keys to repo"}
      </button>
    );
  } else if (repo.setup === "pr-open") {
    action = (
      <a href={repo.setupPr} className={subtle}>
        Merge setup PR
      </a>
    );
  }

  const [owner, name] = repo.name.split("/");
  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
        <RepoChip repo={repo.name} size={36} round="rounded-[9px]" />
        <div className="mr-auto min-w-0 flex-1 basis-48">
          <a href={repo.url} className="block truncate text-[14px] font-medium leading-5 hover:underline">
            <span className="font-normal text-faint">{owner}/</span>
            {name}
          </a>
          <p className="mt-0.5 flex items-start gap-2 text-[13px] leading-5 text-dim md:items-center">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full md:mt-0 ${dot}`} />
            <span className="md:truncate">
              {setupSays}
              {keysSays && `, ${keysSays}`}
            </span>
          </p>
        </div>
        {/* On a phone the controls take a line of their own under the name; the model and the next step
            share it and wrap when they don't fit, the pause button keeps its size. */}
        <div className="flex items-center gap-1.5 max-md:w-full max-md:flex-wrap max-md:pl-[50px] max-md:[&>*:not([aria-label])]:min-w-[8.5rem] max-md:[&>*:not([aria-label])]:flex-1">
          <FixerMenu repo={repo} />
          {action}
          {repo.setup === "active" && (
            <button
              type="button"
              className={iconButton}
              disabled={!!busy || readOnly}
              onClick={togglePause}
              aria-label={paused ? "Resume" : "Pause"}
              title={readOnly ? NEEDS_WRITE : paused ? "Resume: switches Proofed's workflow back on in this repository" : "Pause: switches Proofed's workflow off on GitHub; nothing in the repository changes"}
            >
              {busy === "pause" || busy === "resume" ? <LoaderCircle size={16} className="animate-spin" /> : paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
          )}
        </div>
      </div>
      {note && <p className="mt-2 pl-[50px] text-[13px] max-md:pl-0">{note}</p>}
    </li>
  );
}

export function Repos({ me }: { me: MeView }) {
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
          <div className="mt-3 rounded-xl border border-edge bg-panel p-4">
            <p>Proofed isn't on any of your repositories yet.</p>
            <a href={me.installUrl} className={`${solid} mt-3`}>
              Install on GitHub
            </a>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-edge rounded-xl border border-edge bg-panel">
            {repos.data.map((r) => (
              <RepoRow key={r.name} repo={r} me={me} onChange={reload} />
            ))}
          </ul>
        ))}
    </section>
  );
}
