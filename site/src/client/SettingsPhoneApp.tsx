import { LogOut, Moon, Sun } from "lucide-react";
import type { MeView } from "../worker/api";
import { DEMO } from "./lib";
import type { Theme } from "./theme";
import { Avatar, focus, outline } from "./ui";

// On a phone there's no sidebar: the theme and the account live here, at the end.
export function PhoneApp({ me, theme, onTheme }: { me: MeView; theme: Theme; onTheme: () => void }) {
  const ThemeIcon = theme === "dark" ? Moon : Sun;
  return (
    <section className="md:hidden">
      <h2 className="font-semibold">App</h2>
      <ul className="mt-3 divide-y divide-edge rounded-xl border border-edge bg-panel">
        <li>
          <button type="button" onClick={onTheme} className={`flex h-12 w-full items-center gap-3 px-4 text-left ${focus}`}>
            <ThemeIcon size={18} className="shrink-0 text-dim" />
            <span className="flex-1">Theme</span>
            <span className="text-dim">{theme === "dark" ? "Dark" : "Light"}</span>
          </button>
        </li>
        <li className="flex h-14 items-center gap-3 px-4">
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
  );
}
