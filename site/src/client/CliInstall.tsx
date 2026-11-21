import { Check, ChevronDown, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";

// What follows the manager's name. npm's short `i` keeps the line on one row of a 320px phone.
const managers = {
  npm: "i -g proofed-cli",
  pnpm: "add -g proofed-cli",
  bun: "add -g proofed-cli",
} as const;

type Manager = keyof typeof managers;

const names = Object.keys(managers) as Manager[];
const KEY = "proofed:manager";
const isManager = (value: string | null): value is Manager => names.some((name) => name === value);

// Shared by every copy of the command on the page, so picking pnpm in the hero also shows pnpm further down.
let current: Manager = (() => {
  try {
    const value = localStorage.getItem(KEY);
    return isManager(value) ? value : "npm";
  } catch {
    return "npm";
  }
})();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function pickManager(next: Manager) {
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  for (const listener of listeners) listener();
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No Clipboard API outside a secure context, such as the dev server opened by a LAN address.
    const area = document.createElement("textarea");
    area.value = text;
    area.readOnly = true;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

const ring = "outline-none focus-visible:ring-2 focus-visible:ring-ink/30";

// The install command for the CLI. Its first word opens the choice of package manager; the rest copies it.
export function CliInstall() {
  const manager = useSyncExternalStore(subscribe, () => current);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const command = `${manager} ${managers[manager]}`;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const choose = (next: Manager) => {
    pickManager(next);
    setCopied(false);
    close();
  };

  const onListKey = (e: KeyboardEvent) => {
    const options = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = options.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      options[(at + step + options.length) % options.length]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={root} className="relative max-w-full">
      <div
        className={`inline-flex min-h-11 max-w-full items-stretch rounded-lg border bg-paper font-mono text-[15px] transition max-sm:text-[14px] ${
          open ? "border-ink" : "border-ink/25 hover:border-ink"
        }`}
      >
        <button
          ref={trigger}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={`Package manager: ${manager}`}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
            }
          }}
          className={`group flex shrink-0 cursor-pointer items-center rounded-l-lg pl-5 pr-[0.6ch] max-sm:pl-4 ${ring}`}
        >
          <span aria-hidden className="select-none pr-[1ch] text-muted max-[359px]:hidden">
            $
          </span>
          <span className="font-medium">{manager}</span>
          <ChevronDown
            aria-hidden
            size={13}
            strokeWidth={2.5}
            className={`ml-1 text-muted transition-transform duration-200 group-hover:text-ink ${open ? "rotate-180" : ""}`}
          />
        </button>
        <button
          type="button"
          onClick={async () => setCopied(await copyText(command))}
          aria-label={`Copy ${command}`}
          title="Copy"
          className={`group flex min-w-0 cursor-pointer items-center gap-3 rounded-r-lg pl-[0.6ch] pr-5 max-sm:gap-2.5 max-sm:pr-4 ${ring}`}
        >
          <span className="truncate">{managers[manager]}</span>
          {copied ? (
            <Check aria-hidden size={17} strokeWidth={2.25} className="shrink-0 text-pass" />
          ) : (
            <Copy aria-hidden size={17} strokeWidth={2} className="shrink-0 text-muted transition-colors group-hover:text-ink" />
          )}
        </button>
      </div>
      <span role="status" className="sr-only">
        {copied ? `Copied ${command}` : ""}
      </span>
      {open && (
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Package manager"
          onKeyDown={onListKey}
          // left-2 plus the row's px-3 puts the names in line with the command's first character.
          className="absolute left-2 top-full z-30 mt-1.5 w-32 origin-top-left rounded-xl border border-ink/15 bg-card p-1 shadow-[0_8px_24px_-8px_rgb(22_20_15/0.2)] motion-safe:animate-[pop_140ms_ease-out]"
        >
          {names.map((name) => {
            const selected = name === manager;
            return (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => choose(name)}
                className={`flex h-9 w-full cursor-pointer items-center rounded-lg px-3 text-left font-mono text-[14px] transition-colors hover:bg-ink/[0.06] focus-visible:bg-ink/[0.06] max-sm:h-11 ${
                  selected ? "font-medium text-ink" : "text-ink/75"
                } outline-none`}
              >
                {name}
                <Check aria-hidden size={14} strokeWidth={2.5} className={`ml-auto shrink-0 ${selected ? "" : "invisible"}`} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
