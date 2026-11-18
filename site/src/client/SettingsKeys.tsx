import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { MeView } from "../worker/api";
import { api, message } from "./lib";
import { ClaudeMark, CodexMark, TestMuMark } from "./SettingsMarks";
import { field, focus, link, outline, solid } from "./ui";

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

export function Keys({ me, onSaved }: { me: MeView; onSaved: (message: string) => void }) {
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
