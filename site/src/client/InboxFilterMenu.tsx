import { Check, CircleCheck, CircleDashed, CircleX, Inbox as InboxIcon, ListFilter, Search, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { Backdrop, focus, iconButton, popover, soft, useDismiss, useSheetDrag } from "./ui";

// What the inbox is narrowed to. Kept by the app, so it's still there coming back from a pull request.
export type Status = "needs-you" | "working" | "passed";
// `statuses` empty is every status.
export type InboxFilter = { text: string; statuses: Status[] };
export const NO_FILTER: InboxFilter = { text: "", statuses: [] };

// Each status with the mark and colour its rows carry in the list.
const STATUSES: { value: Status; label: string; icon: LucideIcon; tone: string }[] = [
  { value: "needs-you", label: "Needs you", icon: CircleX, tone: "text-bad" },
  { value: "working", label: "In progress", icon: CircleDashed, tone: "text-busy" },
  { value: "passed", label: "Passed", icon: CircleCheck, tone: "text-ok" },
];

const menuRow = `flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] ${soft} hover:bg-hover active:bg-hover max-md:h-11 max-md:gap-3 max-md:px-3 max-md:text-[15px] ${focus}`;

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
  const on = filter.text.trim() !== "" || filter.statuses.length > 0 || !!repo;
  // Any mix of statuses; all of them is the same as none picked, so it reads as All.
  const toggle = (status: Status) => {
    const next = filter.statuses.includes(status) ? filter.statuses.filter((s) => s !== status) : [...filter.statuses, status];
    onFilter({ statuses: next.length === STATUSES.length ? [] : next });
  };
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
          <div ref={sheet} className={`${popover} w-72`}>
            <label className="flex h-10 items-center gap-2 border-b border-edge px-3 max-md:mx-4 max-md:mb-2 max-md:mt-2 max-md:h-11 max-md:rounded-lg max-md:border max-md:bg-bg">
              <Search size={15} className="shrink-0 text-faint" />
              <input
                ref={input}
                type="search"
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
                className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
              />
            </label>
            <div role="group" aria-label="Status" className="p-1.5 max-md:px-2">
              <button type="button" role="checkbox" aria-checked={filter.statuses.length === 0} className={menuRow} onClick={() => onFilter({ statuses: [] })}>
                <InboxIcon size={15} className="shrink-0 text-dim max-md:size-[18px]" />
                <span className="flex-1">All</span>
                {filter.statuses.length === 0 && <Check size={14} className="max-md:size-[18px]" />}
              </button>
              {STATUSES.map((s) => {
                const picked = filter.statuses.includes(s.value);
                return (
                  <button key={s.value} type="button" role="checkbox" aria-checked={picked} className={menuRow} onClick={() => toggle(s.value)}>
                    <s.icon size={15} className={`shrink-0 max-md:size-[18px] ${s.tone}`} />
                    <span className="flex-1">{s.label}</span>
                    {picked && <Check size={14} className="max-md:size-[18px]" />}
                  </button>
                );
              })}
            </div>
            {repos.length > 1 && (
              <div role="radiogroup" aria-label="Repository" className="border-t border-edge px-2 py-1.5 md:hidden">
                <p className="px-3 pb-1 pt-2 text-[13px] font-medium text-faint">Repository</p>
                {[undefined, ...repos].map((name) => (
                  <button key={name ?? "all"} type="button" role="radio" aria-checked={repo === name} className={menuRow} onClick={() => onRepo(name)}>
                    <span className="flex-1 truncate">{name ? name.split("/")[1] : "All repositories"}</span>
                    {repo === name && <Check size={18} />}
                  </button>
                ))}
              </div>
            )}
            {on && (
              <div className="border-t border-edge p-1.5 max-md:px-2">
                <button
                  type="button"
                  className={`${menuRow} text-dim hover:text-fg`}
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
