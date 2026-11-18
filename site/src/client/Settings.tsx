import { useState } from "react";
import type { MeView } from "../worker/api";
import { Keys } from "./SettingsKeys";
import { PhoneApp } from "./SettingsPhoneApp";
import { Repos } from "./SettingsRepos";
import type { Theme } from "./theme";
import { PageTitle } from "./ui";

export function Settings({ me, reloadMe, theme, onTheme }: { me: MeView; reloadMe: () => void; theme: Theme; onTheme: () => void }) {
  const [saved, setSaved] = useState<string>();
  const [saves, setSaves] = useState(0);
  return (
    <main className="mx-auto max-w-3xl px-4 pb-8 sm:px-8 md:py-7">
      <PageTitle>Settings</PageTitle>
      <div className="mt-6 space-y-10">
        {saved && <p className="rounded-md bg-ok-bg px-3 py-2 text-ok">{saved}</p>}
        <Keys
          me={me}
          onSaved={(text) => {
            setSaved(text);
            setSaves((n) => n + 1);
            reloadMe();
          }}
        />
        {/* Remount after a key save so the secrets status is read again. */}
        <Repos key={saves} me={me} />
        <PhoneApp me={me} theme={theme} onTheme={onTheme} />
      </div>
    </main>
  );
}
