# Contributing

## Development setup

- Use Node.js 20.19 or newer for development; the runtime supports Node.js 18 and newer.
- Run `npm ci` to install the locked dependencies.
- Run `npm run check` before opening a pull request. It runs lint, type checks, tests, and the package build.

## Changes

- Add or update behavior and type tests for changes to the public API.
- Keep implementation consistent with [`design.md`](./design.md); update it when an architectural decision changes.
- Keep pull requests focused and describe user-visible changes and validation performed.
- Do not commit generated `dist/` output or `node_modules/`.

## Security

See [`SECURITY.md`](./SECURITY.md) for reporting vulnerabilities.
