import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { MeView } from "../worker/api";
import { api, message } from "./lib";
import { ClaudeMark, CodexMark, TestMuMark } from "./SettingsMarks";
import { field, iconButton, link, outline, solid } from "./ui";

type KeyBlockProps = {
  title: string;
  sub?: string;
  // The service's mark on its own coloured tile, so each one is known at a glance in the list.
  tile: ReactNode;
  connected: ReactNode;
  hint: ReactNode;
  busy: boolean;
  busyLabel: string;
  onSave: (e: FormEvent<HTMLFormElement>, done: () => void) => void;
  // The inputs, placeholder-labelled: the row has no room for labels above them.
  fields: ReactNode;
};

// One row of the keys list: the service, whether its key is saved, and Change (or Add). The form opens
// under the row, so a key that isn't saved yet looks like the others until someone adds it.
function KeyBlock({ title, sub, tile, connected, hint, busy, busyLabel, onSave, fields }: KeyBlockProps) {
  // A boolean, not `connected` itself: that's a new element on every render, and the page re-renders
  // as it polls, which would close the form under the user's hands.
  const saved = !!connected;
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (saved) setEditing(false);
  }, [saved]);
  const form = useRef<HTMLFormElement>(null);
  const cancel = () => {
    form.current?.reset();
    setEditing(false);
  };
  useEffect(() => {
    if (editing) form.current?.querySelector("input")?.focus();
  }, [editing]);

  return (
    <li className="px-4 py-3.5">
      <div className="flex items-center gap-3.5">
        {tile}
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-medium leading-5">
            {title} {sub && <span className="font-normal text-faint">{sub}</span>}
          </h3>
          <p className="mt-0.5 flex items-center gap-2 text-[13px] leading-5 text-dim">
            <span className={`size-2 shrink-0 rounded-full ${saved ? "bg-ok" : "bg-faint/60"}`} />
            <span className="truncate">{connected ?? "Not connected"}</span>
          </p>
        </div>
        {editing ? (
          <button type="button" onClick={cancel} aria-label="Cancel" title="Cancel" className={iconButton}>
            <X size={16} />
          </button>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className={outline}>
            {saved ? "Change" : "Add key"}
          </button>
        )}
      </div>
      {editing && (
        <form ref={form} onSubmit={(e) => onSave(e, () => setEditing(false))} className="mt-3 pl-[50px] max-sm:pl-0" style={{ animation: "fade-in 160ms ease-out" }}>
          <p className="text-[13px] text-dim">{hint}</p>
          <div className="mt-2.5 flex gap-2 max-sm:flex-col">
            {fields}
            <button className={solid} disabled={busy}>
              {busy ? busyLabel : "Save"}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

const tile = (colours: string, mark: ReactNode) => (
  <span className={`grid size-9 shrink-0 place-items-center rounded-[9px] ${colours}`}>{mark}</span>
);

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
      const r = await api<{ synced: number; of: number; warning?: string }>("/api/keys", { method: "POST", body: JSON.stringify(payload) });
      formEl.reset();
      done();
      const saved = r.of > 0 ? `Saved, and added to ${r.synced} of ${r.of} repositories.` : "Saved.";
      onSaved(r.warning ? `${saved} ${r.warning}` : saved);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 className="font-semibold">Your keys</h2>
      {error && <p className="mt-3 rounded-md bg-bad-bg px-3 py-2 text-bad">{error}</p>}
      <ul className="mt-4 divide-y divide-edge rounded-xl border border-edge bg-panel">
        <KeyBlock
          title="TestMu"
          sub="Kane CLI"
          tile={tile("bg-[#1c1c1c] text-white ring-1 ring-inset ring-white/10", <TestMuMark size={14} />)}
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
          sub="Anthropic"
          tile={tile("bg-[#D97757]", <ClaudeMark size={20} color="#fff" />)}
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
          tile={tile("bg-white text-black ring-1 ring-inset ring-black/10", <CodexMark size={20} />)}
          connected={me.codex ? "API key saved" : null}
          hint={<>An API key from <a href="https://platform.openai.com/api-keys" className={link}>OpenAI</a>. API usage is billed to your OpenAI account.</>}
          busy={busy}
          busyLabel="Saving…"
          onSave={save({ codexKey: "key" })}
          fields={<input name="key" aria-label="OpenAI API key" placeholder="API key" className={keyField} type="password" autoComplete="off" required />}
        />
      </ul>
    </section>
  );
}
