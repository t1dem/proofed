import { Check, ChevronDown, Search } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { FixerView, RepoView } from "../worker/api";
import { defaultModel, effortsFor, modelLabel, MODELS, PROVIDERS, providerLabel, providerOf, type Provider } from "../worker/models";
import type { PullDetail, PullView } from "../worker/runs";
import { api, fetchInto, message, mutate } from "./lib";
import { ClaudeMark, CodexMark } from "./SettingsMarks";
import { Backdrop, focus, NEEDS_WRITE, popover, soft, subtle, useDismiss, useSheetDrag } from "./ui";

// A row in the model menu: the same height and weight picked or not, so nothing moves under the mouse.
const menuRow = `flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] ${soft} hover:bg-hover active:bg-hover max-md:h-11 max-md:text-[15px] ${focus}`;

// The provider, model and effort used in this repo, and whether it fixes on its own,
// saved as Actions variables. One button in the repo's row; in the menu the providers on a rail, their
// models with a search over all of them, effort as segments and the switch for fixing automatically.
export function FixerMenu({ repo }: { repo: RepoView }) {
  const [draft, setDraft] = useState<FixerView>();
  const fixer = draft ?? repo.fixer;
  const [provider, setProvider] = useState<Provider>(() => providerOf(fixer?.model ?? ""));
  const saves = useRef(Promise.resolve());
  const latestSave = useRef(0);
  const confirmed = useRef(fixer);
  const pending = useRef(false);
  useLayoutEffect(() => {
    if (!pending.current) confirmed.current = repo.fixer;
  }, [repo.fixer]);
  const [saving, setSaving] = useState<"model" | "effort" | "auto">();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setTyping(false);
    setQuery("");
  }, []);
  useDismiss(open, close, box);
  const sheet = useSheetDrag(open && !!fixer, close);

  if (!fixer) {
    const permission = (
      <a
        href={`https://github.com/settings/installations/${repo.installationId}`}
        className={subtle}
        title="Proofed needs a new permission on GitHub to set the fixer model"
      >
        Allow model choice
      </a>
    );
    if (!error) return permission;
    return (
      <div>
        {permission}
        <p className="mt-2 text-[13px] text-bad">{error}</p>
      </div>
    );
  }

  const providerName = providerLabel(providerOf(fixer.model));
  const custom = !MODELS.some((m) => m.id === fixer.model);
  const setFixer = (next: FixerView | null, preserveDuringRefresh = false) => {
    const options = { preserveDuringRefresh };
    mutate<RepoView[]>("/api/repos", (all) => all.map((r) => (r.name === repo.name ? { ...r, fixer: next } : r)), options);
    mutate<PullView[]>("/api/pulls", (all) => all.map((p) => {
      if (p.repo !== repo.name) return p;
      const fixer = next ?? undefined;
      mutate<PullDetail>(`/api/pulls/${p.repo}/${p.pr}`, (detail) => ({ ...detail, pull: { ...detail.pull, fixer } }), options);
      return { ...p, fixer };
    }), options);
  };
  const save = (next: FixerView, what: "model" | "effort" | "auto") => {
    const id = ++latestSave.current;
    pending.current = true;
    setDraft(next);
    setFixer(next);
    setSaving(what);
    setError(undefined);
    // Keep rapid selections in order so the last visible choice is also the last saved.
    saves.current = saves.current.then(async () => {
      try {
        const { fixer: saved } = await api<{ fixer: FixerView }>(`/api/repos/${repo.name}/fixer`, { method: "POST", body: JSON.stringify(next) });
        confirmed.current = saved;
        if (id === latestSave.current) setFixer(saved, true);
      } catch (e) {
        if (id === latestSave.current) {
          setError(message(e));
          // A refresh already underway can still contain the settings from before the save.
          const repos = await fetchInto<RepoView[]>("/api/repos", { afterInFlight: true }).catch(() => undefined);
          if (id === latestSave.current) {
            const fresh = repos?.find((r) => r.name === repo.name);
            const reconciled = fresh ? fresh.fixer : confirmed.current;
            confirmed.current = reconciled;
            setFixer(reconciled, !!fresh);
          }
        }
      } finally {
        if (id === latestSave.current) {
          pending.current = false;
          setDraft(undefined);
          setSaving(undefined);
        }
      }
    });
    return saves.current;
  };
  const saveOther = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const model = String(new FormData(e.currentTarget).get("model") ?? "").trim().toLowerCase();
    setTyping(false);
    if (model && model !== fixer.model) void save({ ...fixer, provider: providerOf(model), model, effort: effortsFor(model).some((e) => e === fixer.effort) ? fixer.effort : "high" }, "model");
  };
  const tick = (on: boolean) => on && <Check size={14} className="shrink-0 text-fg" />;
  // Typing searches every provider's models; otherwise the list is the picked provider's.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length
    ? MODELS.filter((m) => words.every((w) => `${modelLabel(m.id)} ${m.id} ${providerLabel(m.provider)}`.toLowerCase().includes(w)))
    : MODELS.filter((m) => m.provider === provider);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        disabled={repo.access === "read"}
        onClick={() => {
          if (!open) setProvider(providerOf(fixer.model));
          setOpen(!open);
        }}
        title={repo.access === "read" ? NEEDS_WRITE : "The model that fixes this repository"}
        className={`${subtle} max-md:w-full`}
      >
        {providerOf(fixer.model) === "codex" ? <CodexMark size={14} /> : <ClaudeMark size={14} />}
        {custom ? <span className="max-w-40 truncate font-mono text-[12px]">{fixer.model}</span> : modelLabel(fixer.model)}
        <span className="font-normal text-dim">{fixer.effort}</span>
        <ChevronDown size={14} className={`text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <Backdrop onClose={close} />
          {/* A fixed size whatever the provider: more models or reasoning levels scroll inside their column, the menu never resizes. */}
          <div ref={sheet} className={`${popover} w-[min(640px,calc(100vw-48px))] overflow-hidden`}>
            <div className="grid grid-cols-[56px_minmax(0,1fr)_224px] md:h-[372px] max-md:grid-cols-[56px_minmax(0,1fr)]">
              {/* The providers as a rail of their marks; the list on the right shows the picked one's models. */}
              <div role="tablist" aria-label="Provider" className="relative flex flex-col items-center gap-1.5 border-r border-edge bg-bg/50 py-2.5">
                {/* The picked provider's mark: a bar on the rail's edge that slides to it. */}
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute right-[3px] top-[18px] z-10 h-6 w-1 rounded-full bg-accent transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${query ? "opacity-0" : "opacity-100"}`}
                  style={{ transform: `translateY(${PROVIDERS.indexOf(provider) * 46}px)` }}
                />
                {PROVIDERS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="tab"
                    aria-label={providerLabel(p)}
                    aria-selected={!query && provider === p}
                    title={providerLabel(p)}
                    onClick={() => {
                      setTyping(false);
                      setQuery("");
                      setProvider(p);
                    }}
                    className={`grid size-10 place-items-center rounded-[10px] transition-[background-color,opacity] duration-200 ${focus} hover:bg-hover/70 ${!query && provider === p ? "text-fg opacity-100" : "text-dim opacity-55 hover:opacity-100"}`}
                  >
                    {p === "claude" ? <ClaudeMark size={20} /> : <CodexMark size={20} />}
                  </button>
                ))}
              </div>
              <div className="flex min-h-0 min-w-0 flex-col p-2">
                <label className="inset flex h-9 items-center gap-2 rounded-lg px-2.5 max-md:h-11">
                  <Search size={14} className="shrink-0 text-faint" />
                  <input
                    value={query}
                    onChange={(e) => {
                      setTyping(false);
                      setQuery(e.target.value);
                    }}
                    placeholder="Search models…"
                    aria-label="Search models"
                    className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint max-md:text-[16px]"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <div className="-mx-1 mt-1.5 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1">
                  {shown.length === 0 && <p className="px-2 py-3 text-[13px] text-faint">No model matches “{query}”.</p>}
                  {shown.map((m) => {
                    const on = fixer.model === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={`${menuRow} ${on ? "bg-hover text-fg" : "text-dim hover:text-fg"}`}
                        onClick={() => {
                          setTyping(false);
                          if (m.id !== fixer.model) void save({ ...fixer, provider: m.provider, model: m.id, effort: m.efforts.some((e) => e === fixer.effort) ? fixer.effort : "high" }, "model");
                        }}
                      >
                        {query && <span className="grid w-4 shrink-0 place-items-center">{m.provider === "claude" ? <ClaudeMark size={14} /> : <CodexMark size={14} />}</span>}
                        <span className="flex-1 truncate">{modelLabel(m.id)}</span>
                        {tick(on)}
                      </button>
                    );
                  })}
                  {!query && provider === "claude" && (typing ? (
                    <form onSubmit={saveOther} className="inset flex h-8 items-center gap-1 rounded-lg pl-2 pr-1 max-md:h-11">
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
                      <button className={`h-6 shrink-0 rounded-md px-2 text-[12px] font-medium text-bg transition-colors bg-fg hover:bg-fg/85 ${focus}`}>Save</button>
                    </form>
                  ) : (
                    <button type="button" className={`${menuRow} ${custom ? "bg-hover text-fg" : "text-faint hover:text-fg"}`} onClick={() => setTyping(true)} title="A full model ID">
                      <span className={`flex-1 truncate ${custom ? "font-mono text-[12px]" : ""}`}>{custom ? fixer.model : "Other model ID…"}</span>
                      {tick(custom)}
                    </button>
                  ))}
                </div>
              </div>
              {/* On the right: how hard the model thinks, then whether it fixes on its own. */}
              <div className="flex min-h-0 flex-col border-l border-edge max-md:col-span-2 max-md:border-l-0 max-md:border-t">
                <div role="radiogroup" aria-label="Reasoning" className="min-h-0 flex-1 overflow-y-auto p-2">
                  <p className="px-2 pb-1.5 pt-1 text-[12px] font-medium text-faint">Reasoning</p>
                  <div className="flex flex-col gap-px">
                    {effortsFor(fixer.model).map((effort) => {
                      const on = fixer.effort === effort;
                      return (
                        <button
                          key={effort}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => !on && save({ ...fixer, effort }, "effort")}
                          className={`${menuRow} ${on ? "bg-hover text-fg" : "text-dim hover:text-fg"}`}
                        >
                          <span className="flex-1 capitalize">{effort}</span>
                          {tick(on)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="shrink-0 border-t border-edge p-1.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={fixer.auto}
                    disabled={saving === "auto"}
                    onClick={() => save({ ...fixer, auto: !fixer.auto }, "auto")}
                    className={`group flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left ${focus}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium max-md:text-[15px]">Fix automatically</span>
                      <span className="mt-0.5 block text-[12px] leading-4 text-faint max-md:text-[13px]">
                        When Kane sees a scenario fail, {providerName} starts a fix right away. Not on drafts or runs marked not checked.
                      </span>
                    </span>
                    <span className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${fixer.auto ? "bg-accent" : "bg-fg/15 group-hover:bg-fg/25"}`}>
                      <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.4)] transition-[left] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${fixer.auto ? "left-[18px]" : "left-0.5"}`} />
                    </span>
                  </button>
                </div>
              </div>
            </div>
            {error && <p className="border-t border-edge px-3.5 py-2.5 text-[13px] text-bad">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
