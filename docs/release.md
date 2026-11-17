# Releasing proofed-cli

To release, confirm the version in `package.json` (currently `0.1.3`); published versions cannot be reused. From a clean checkout with Node 22.18+:

```sh
pnpm install --frozen-lockfile
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish --access public --registry=https://registry.npmjs.org/
npm view proofed-cli@0.1.3 version bin engines dist.tarball --registry=https://registry.npmjs.org/
npx --yes proofed-cli@0.1.3 --version
npx --yes proofed-cli@0.1.3 --help
```

Use the chosen version in the last three commands. `npm publish` runs typecheck, tests and the package check before packing a fresh build. Publishing is manual; no release workflow runs on pushes or pull requests.
