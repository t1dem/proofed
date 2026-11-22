# Releasing proofed-cli

To release, confirm the version in `package.json` (currently `0.2.3`). Published versions cannot be reused.
Publish from macOS or Linux. The package check uses POSIX npm install paths.
Run these commands from a clean checkout with Node 22.18+.

```sh
pnpm install --frozen-lockfile
pnpm --dir site install --frozen-lockfile
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish --access public --registry=https://registry.npmjs.org/
npm view proofed-cli@0.2.3 version bin engines dist.tarball --registry=https://registry.npmjs.org/
npx --yes proofed-cli@0.2.3 --version
npx --yes proofed-cli@0.2.3 --help
```

Use the chosen version in the last three commands. `npm publish` runs typecheck, tests and the package check before packing a fresh build. Publishing is manual; no release workflow runs on pushes or pull requests.

## Code

Node 22.18+ runs the checkout's TypeScript directly, so the GitHub Action needs no build or package install. `pnpm build` emits the CLI and its imports to `dist/` for npm; `npm pack` builds it automatically. `pnpm typecheck` and `pnpm test` check the source. `pnpm check:package` builds a tarball, checks its contents, installs it into a temporary prefix and runs its version and help, then removes its temp files.

Before deploying the Worker, run `pnpm exec wrangler d1 migrations apply proofed --remote` from `site/`. This applies every pending migration in `site/migrations/`, including `0008_codex_key.sql`, which adds the `codex_key` column the Worker needs. Then run `pnpm deploy` from `site/`.

| File | What it does |
|---|---|
| `src/action/cli.ts` | The PR check |
| `src/fix/fix.ts` | The fix loop |
| `src/check/run.ts` | One scenario: target preparation, recording, Kane, clip |
| `src/fix/generate.ts` | The setup PR's first scenarios |
| `src/action/mode.ts` | Decides what an event asks for |
| `site/` | The dashboard, `/try` and the Cloudflare Worker behind them |
