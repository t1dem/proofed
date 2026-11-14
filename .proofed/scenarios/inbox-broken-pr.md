---
name: Broken pull request shows what Kane saw
paths: [site/index.html, site/src/client/main.tsx, site/src/client/index.css, site/src/client/App.tsx, site/src/client/Inbox.tsx, site/src/client/Pull.tsx, site/src/client/lib.ts, site/src/client/ui.tsx, site/src/client/demo.ts, src/runfile.ts]
url: /app?demo
---
Check that the inbox row Make the free shipping threshold easier to read #2 says Free shipping from €50 broke.
Press the row Make the free shipping threshold easier to read #2.
Check that the heading reads Make the free shipping threshold easier to read #2 and the Fix with Claude button is shown.
Check that the What Kane saw section gives the diagnosis: The threshold constant is now in cents, and the note under the headline divides it by 100 a second time.
Check that the last of Kane's steps reads Checked the free shipping note. It reads “from €0.50”, the threshold is €50.00
