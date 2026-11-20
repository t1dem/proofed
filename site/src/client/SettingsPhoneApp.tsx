import { LogOut, Moon, Sun } from "lucide-react";
import type { MeView } from "../worker/api";
import { DEMO } from "./lib";
import type { Theme } from "./theme";
import { Avatar, focus, Kbd, outline } from "./ui";

// Two columns: getting around the inbox, and acting on what's open or from anywhere.
const KEYS = [
  [
    ["Next", ["J"]],
    ["Previous", ["K"]],
    ["Open", ["↵"]],
    ["Filter", ["/"]],
  ],
  [
    ["Fix", ["F"]],
    ["Run again", ["R"]],
    ["Go to…", ["⌘", "K"]],
    ["Sidebar", ["⌘", "\\"]],
  ],
] as const;

const THEMES = [
  ["light", "Light", Sun],
  ["dark", "Dark", Moon],
] as const;

// About the whole app, not one repository: the theme everywhere; the account on a phone, which has no
// sidebar to show it; the keys on a wider screen, where there's a keyboard.
export function PhoneApp({ me, theme, onTheme }: { me: MeView; theme: Theme; onTheme: () => void }) {
  return (
    <>
      <section>
        <h2 className="font-semibold">App</h2>
        <ul className="mt-3 divide-y divide-edge rounded-xl border border-edge bg-panel">
          {/* No line under it where the account row below is hidden. */}
          <li className="flex h-14 items-center gap-3 px-4 md:border-b-0">
            <span className="flex-1">Theme</span>
            <div role="radiogroup" aria-label="Theme" className="flex rounded-lg border border-edge bg-bg p-0.5">
              {THEMES.map(([value, label, Icon]) => {
                const on = theme === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => !on && onTheme()}
                    className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors max-md:h-9 max-md:px-3.5 max-md:text-[14px] ${on ? "bg-hover text-fg shadow-sm" : "text-faint hover:text-fg"} ${focus}`}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                );
              })}
            </div>
          </li>
          <li className="flex h-14 items-center gap-3 px-4 md:hidden">
            <Avatar me={me} />
            {/* The demo's account is made up; signing out from it would sign out whoever is really signed in. */}
            <span className="min-w-0 flex-1 truncate">{DEMO ? "Demo on sample data" : me.login}</span>
            <a href={DEMO ? "/app" : "/logout"} className={outline}>
              <LogOut size={14} />
              {DEMO ? "Leave the demo" : "Sign out"}
            </a>
          </li>
        </ul>
      </section>
      <section className="max-md:hidden">
        <h2 className="font-semibold">Keyboard shortcuts</h2>
        <div className="mt-3 grid grid-cols-2 divide-x divide-edge rounded-xl border border-edge bg-panel">
          {KEYS.map((column, i) => (
            <dl key={i} className="divide-y divide-edge">
              {column.map(([does, keys]) => (
                <div key={does} className="flex h-11 items-center justify-between gap-3 px-4">
                  <dt>{does}</dt>
                  <dd className="flex gap-1">
                    {keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          ))}
        </div>
      </section>
    </>
  );
}
