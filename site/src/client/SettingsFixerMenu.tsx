import { Check, ChevronDown } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { FixerView, RepoView } from "../worker/api";
import { defaultModel, effortsFor, modelLabel, MODELS, PROVIDERS, providerLabel, providerOf, type Provider } from "../worker/models";
import type { PullDetail, PullView } from "../worker/runs";
import { api, message, mutate } from "./lib";
import { ClaudeMark, CodexMark } from "./SettingsMarks";
import { Backdrop, focus, NEEDS_WRITE, outline, popover, soft, useDismiss, useSheetDrag } from "./ui";

// A row in the model menu: the same height and weight picked or not, so nothing moves under the mouse.
const menuRow = `flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] ${soft} hover:bg-hover active:bg-hover max-md:h-11 max-md:text-[15px] ${focus}`;

// The provider, model and effort used in this repo, and whether it fixes on its own,
// saved as Actions variables. One button in the repo's row; models on the left of the menu, effort on
// the right, the switch for fixing automatically under both.
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
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setTyping(false);
  }, []);
  useDismiss(open, close, box);
  const sheet = useSheetDrag(open && !!fixer, close);

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

  const providerName = providerLabel(providerOf(fixer.model));
  const custom = !MODELS.some((m) => m.id === fixer.model);
  const setFixer = (next: FixerView, preserveDuringRefresh = false) => {
    mutate<RepoView[]>("/api/repos", (all) => all.map((r) => (r.name === repo.name ? { ...r, fixer: next } : r)), { preserveDuringRefresh });
    mutate<PullView[]>("/api/pulls", (all) => all.map((p) => {
      if (p.repo !== repo.name) return p;
      mutate<PullDetail>(`/api/pulls/${p.repo}/${p.pr}`, (detail) => ({ ...detail, pull: { ...detail.pull, fixer: next } }));
      return { ...p, fixer: next };
    }));
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
          const previous = confirmed.current ?? fixer;
          setFixer(previous);
          setError(message(e));
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
  const tick = (on: boolean) => on && <Check size={14} className="shrink-0" />;

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
          <div className="grid min-h-[232px] grid-cols-[52px_minmax(0,1fr)_120px] max-md:min-h-[304px] max-md:grid-cols-[52px_minmax(0,1fr)_104px]">
            <div role="tablist" aria-label="Provider" className="relative flex flex-col items-center gap-1 border-r border-edge py-2">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-0.5 top-[18px] z-10 h-5 w-[3px] rounded-full bg-work transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                style={{ transform: `translateY(${PROVIDERS.indexOf(provider) * 44}px)` }}
              />
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
                    setProvider(p);
                  }}
                  className={`relative grid size-10 place-items-center rounded-lg text-dim hover:bg-fg/[0.08] hover:text-fg ${focus} ${provider === p ? "text-fg" : ""}`}
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
                  {tick(fixer.model === m.id)}
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
                  {tick(custom)}
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
                  {tick(fixer.effort === effort)}
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
                  When Kane sees a scenario fail, {providerName} starts a fix right away. Not on drafts or runs marked not checked.
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
