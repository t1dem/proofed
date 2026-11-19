# Releasing proofed-cli

To release, confirm the version in `package.json` (currently `0.2.1`). Published versions cannot be reused.
Publish from macOS or Linux. The package check uses POSIX npm install paths.
Run these commands from a clean checkout with Node 22.18+.

```sh
pnpm install --frozen-lockfile
pnpm --dir site install --frozen-lockfile
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish --access public --registry=https://registry.npmjs.org/
npm view proofed-cli@0.2.1 version bin engines dist.tarball --registry=https://registry.npmjs.org/
npx --yes proofed-cli@0.2.1 --version
npx --yes proofed-cli@0.2.1 --help
```

Use the chosen version in the last three commands. `npm publish` runs typecheck, tests and the package check before packing a fresh build. Publishing is manual; no release workflow runs on pushes or pull requests.
