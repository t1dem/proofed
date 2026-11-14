---
name: Pause in Settings stops a repository's checks
paths: [site/src/client/App.tsx, site/src/client/Settings.tsx, site/src/client/ui.tsx, site/src/client/lib.ts, site/src/client/demo.ts]
url: /app?demo
---
Press the gear icon titled "Settings" in the sidebar.
Check that the page heading reads "Settings" and "t1dem/proofed-demo-store" is listed under "Repositories".
In the row for "t1dem/proofed-demo-store", press "Pause".
Check that the row says "Paused: pull requests aren't checked and /proofed isn't answered" and its button reads "Resume".
