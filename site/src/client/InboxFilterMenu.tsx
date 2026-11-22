import { Check, CircleCheck, CircleDashed, CircleSlash, CircleX, Inbox as InboxIcon, ListFilter, Search, Wrench, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { Backdrop, focus, iconButton, Kbd, popover, RepoChip, Segmented, soft, useDismiss, useSheetDrag } from "./ui";

// What the inbox is narrowed to. Kept by the app, so it's still there coming back from a pull request.
export type Status = "needs-you" | "working" | "passed";
// How the fixer's last try went: its commit is in and worth a look, or it gave up and it's yours.
export type FixResult = "fixed" | "gave-up";
// How recently Proofed last checked the pull request.
export type Since = "any" | "day" | "week";
// `statuses` empty is every status; `fixes` empty is with or without a fix.
export type InboxFilter = { text: string; statuses: Status[]; fixes: FixResult[]; since: Since };
export const NO_FILTER: InboxFilter = { text: "", statuses: [], fixes: [], since: "any" };

// Each status with the mark and colour its rows carry in the list.
const STATUSES: { value: Status; label: string; icon: LucideIcon; tone: string }[] = [
  { value: "needs-you", label: "Needs you", icon: CircleX, tone: "text-bad" },
  { value: "working", label: "In progress", icon: CircleDashed, tone: "text-busy" },
  { value: "passed", label: "Passed", icon: CircleCheck, tone: "text-ok" },
];

const FIXES: { value: FixResult; label: string; icon: LucideIcon; tone: string }[] = [
  { value: "fixed", label: "Fixed", icon: Wrench, tone: "text-work" },
  { value: "gave-up", label: "Gave up", icon: CircleSlash, tone: "text-faint" },
];

const SINCE: { value: Since; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "day", label: "24 hours" },
  { value: "week", label: "7 days" },
];

const menuRow = `flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] ${soft} hover:bg-hover active:bg-hover max-md:h-11 max-md:gap-3 max-md:px-3 max-md:text-[15px] ${focus}`;

type FilterMenuProps = {
  filter: InboxFilter;
  onFilter: (f: Partial<InboxFilter>) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
  repos: string[];
  repo: string | undefined;
  onRepo: (repo: string | undefined) => void;
};

// The filter behind one icon next to the title: a search field and the statuses (on a phone, a sheet,
// with the repositories too, which a desktop has in the sidebar). The icon stays lit while anything
// is filtered out, so a short list never looks like everything.
export function FilterMenu({ filter, onFilter, open, onOpen, repos, repo, onRepo }: FilterMenuProps) {
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useCallback(() => onOpen(false), [onOpen]);
  useDismiss(open, close, box);
  const sheet = useSheetDrag(open, close);
  // With a mouse, straight into the field. A phone would throw its keyboard over the sheet.
  useEffect(() => {
    if (open && matchMedia("(pointer: fine)").matches) input.current?.focus();
  }, [open]);
  const on = filter.text.trim() !== "" || filter.statuses.length > 0 || filter.fixes.length > 0 || filter.since !== "any" || !!repo;
  // Any mix of statuses; all of them is the same as none picked, so it reads as All.
  const toggle = (status: Status) => {
    const next = filter.statuses.includes(status) ? filter.statuses.filter((s) => s !== status) : [...filter.statuses, status];
    onFilter({ statuses: next.length === STATUSES.length ? [] : next });
  };
  // Unlike the statuses, both picked isn't everything: it's every pull request a fixer has tried.
  const toggleFix = (fix: FixResult) => onFilter({ fixes: filter.fixes.includes(fix) ? filter.fixes.filter((f) => f !== fix) : [...filter.fixes, fix] });
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => onOpen(!open)}
        aria-expanded={open}
        aria-label="Filter"
        title="Filter (/)"
        className={`${iconButton} ${open || on ? "bg-hover text-fg" : ""}`}
      >
        <ListFilter size={16} className="max-md:size-5" />
      </button>
      {open && (
        <>
          <Backdrop onClose={close} />
          <div ref={sheet} className={`${popover} w-80 overflow-hidden`}>
            <div className="p-2 max-md:px-4 max-md:pt-1">
              <label className="inset flex h-9 items-center gap-2 rounded-lg px-2.5 max-md:h-11">
                <Search size={14} className="shrink-0 text-faint" />
                <input
                  ref={input}
                  type="search"
                  name="pull-filter"
                  enterKeyHint="search"
                  value={filter.text}
                  onChange={(e) => onFilter({ text: e.target.value })}
                  onKeyDown={(e) => {
                    // The first Escape empties the field; the next one closes the menu (useDismiss).
                    if (e.key === "Escape" && filter.text) {
                      e.nativeEvent.stopPropagation();
                      onFilter({ text: "" });
                    }
                    if (e.key === "Enter") onOpen(false);
                  }}
                  aria-label="Filter pull requests"
                  placeholder="Title, #number, repository…"
                  className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint max-md:text-[16px] [&::-webkit-search-cancel-button]:hidden"
                />
                {!filter.text && (
                  <span className="max-md:hidden">
                    <Kbd>/</Kbd>
                  </span>
                )}
              </label>
            </div>
            <div role="group" aria-label="Status" className="flex flex-col gap-px px-2 pb-2 max-md:px-3">
              <p className="px-2 pb-1 text-[12px] font-medium text-faint">Status</p>
              <button type="button" role="checkbox" aria-checked={filter.statuses.length === 0} className={`${menuRow} ${filter.statuses.length === 0 ? "bg-hover text-fg" : "text-dim hover:text-fg"}`} onClick={() => onFilter({ statuses: [] })}>
                <InboxIcon size={15} className="shrink-0 max-md:size-[18px]" />
                <span className="flex-1">All</span>
                {filter.statuses.length === 0 && <Check size={14} className="text-fg max-md:size-[18px]" />}
              </button>
              {STATUSES.map((s) => {
                const picked = filter.statuses.includes(s.value);
                return (
                  <button key={s.value} type="button" role="checkbox" aria-checked={picked} className={`${menuRow} ${picked ? "bg-hover text-fg" : "text-dim hover:text-fg"}`} onClick={() => toggle(s.value)}>
                    <s.icon size={15} className={`shrink-0 max-md:size-[18px] ${s.tone}`} />
                    <span className="flex-1">{s.label}</span>
                    {picked && <Check size={14} className="text-fg max-md:size-[18px]" />}
                  </button>
                );
              })}
            </div>
            <div role="group" aria-label="Fix" className="flex flex-col gap-px border-t border-edge px-2 py-2 max-md:px-3">
              <p className="px-2 pb-1 text-[12px] font-medium text-faint">Fix</p>
              {FIXES.map((f) => {
                const picked = filter.fixes.includes(f.value);
                return (
                  <button key={f.value} type="button" role="checkbox" aria-checked={picked} className={`${menuRow} ${picked ? "bg-hover text-fg" : "text-dim hover:text-fg"}`} onClick={() => toggleFix(f.value)}>
                    <f.icon size={15} className={`shrink-0 max-md:size-[18px] ${f.tone}`} />
                    <span className="flex-1">{f.label}</span>
                    {picked && <Check size={14} className="text-fg max-md:size-[18px]" />}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-edge px-4 py-2.5 max-md:px-5">
              <p className="text-[12px] font-medium text-faint">Checked</p>
              <Segmented label="Checked" value={filter.since} options={SINCE} onChange={(since) => onFilter({ since })} />
            </div>
            {repos.length > 1 && (
              <div role="radiogroup" aria-label="Repository" className="flex flex-col gap-px border-t border-edge px-3 py-2 md:hidden">
                <p className="px-2 pb-1 pt-1 text-[12px] font-medium text-faint">Repository</p>
                {[undefined, ...repos].map((name) => (
                  <button key={name ?? "all"} type="button" role="radio" aria-checked={repo === name} className={`${menuRow} ${repo === name ? "bg-hover text-fg" : "text-dim"}`} onClick={() => onRepo(name)}>
                    {name ? <RepoChip repo={name} size={18} /> : <InboxIcon size={18} className="shrink-0" />}
                    <span className="flex-1 truncate">{name ? name.split("/")[1] : "All repositories"}</span>
                    {repo === name && <Check size={18} className="text-fg" />}
                  </button>
                ))}
              </div>
            )}
            {on && (
              <div className="border-t border-edge p-2 max-md:px-3">
                <button
                  type="button"
                  className={`${menuRow} justify-center text-dim hover:text-fg`}
                  onClick={() => {
                    onFilter(NO_FILTER);
                    onRepo(undefined);
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
