---
name: Fixed pull request shows before and after
paths: [site/index.html, site/src/client/main.tsx, site/src/client/index.css, site/src/client/App.tsx, site/src/client/Inbox.tsx, site/src/client/Pull.tsx, site/src/client/lib.ts, site/src/client/ui.tsx, site/src/client/demo.ts, src/runfile.ts, src/models.ts, site/src/worker/models.ts]
url: /app?demo=fixed
---
Press the row Make the free shipping threshold easier to read #2 in the inbox.
Check that the After run's verdict reads Shipping is €4.90 at €49.40 and Free at €55.90.
Check that the Before run's verdict reads The page says “Free shipping from €0.50”. Expected €50.
Press Before the fix.
Check that Before the fix is now the selected choice.
Check that the What changed section lists src/pricing.ts with +2 −2.
Check that its summary reads The threshold moved to cents but the label still divided by 100.
