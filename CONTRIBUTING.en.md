# Contributing

[中文](CONTRIBUTING.md)

Decide the kind of change first. New features, or changes to alert timing and decision logic, need an issue describing the situation before a PR. Documentation fixes, typos, and test additions can go straight in.

## Requirements

- Node.js 18 or newer (see `engines` in `package.json`).
- There is no build step: `lib/client.js` is injected into the page and `lib/index.js` is the plugin entry, both hand-written.
- Host testing relies on a local DSH installation; `smoke/cordis-host-test.mjs` probes for it. In a source checkout without profile dependencies, point `DSH_CORDIS_PATH` at cordis (see "Development" in the README).

## Must pass before submitting

```sh
npm test          # smoke-test (state machine) + host-route-test (host half) + cordis-host-test (skips when no host is found)
npm run pack      # confirm the published tarball holds no unexpected files
```

When `lib/focus-window.ps1` changes, also run the raise script manually; it has to print `FOCUSED=1`.

## Code conventions

- `lib/client.js`: page-side logic. New user-facing notification copy goes into both `zh` and `en` under `TXT`; settings panel copy lives in `UI_zh` and `UI_en`. A missing side shows Chinese text, or nothing, in the other language.
- New setting: a default in `DEFAULTS`, a row in the settings panel, and a state-machine case in `smoke/smoke-test.cjs`.
- `lib/index.js`: host-side logic and the raise-window loopback route. Explain the motive before changing its gate; that route is the plugin's external security boundary.
- `package.json`: the `files` whitelist decides what ships, so add new files there if they should be published. The `dsh.compatibility` release table is filled by the maintainer after real testing; do not add unverified versions.
- Docs: `README.md` and `README.en.md` change together.
- Do not commit `AGENTS.md`, `temp-*`, `node_modules/`, or `.npm-cache/`; `.gitignore` already covers them.

## Tests

`smoke/smoke-test.cjs` is the offline state-machine test: three host generations, the master switch, Chinese and English copy, the quick-decision bridge, idle detection, and toast tag length. Add a case when you add a branch, a setting, or copy, otherwise regressions only surface by hand. `smoke/cordis-host-test.mjs` skipping when no local DSH is found is expected.

## Credits

External PRs are rewritten and landed by the maintainer: the original commit is not reused, no `Co-authored-by` trailer is added, and the contributor is credited in the README table. Credits live in the README alone: `CHANGELOG` and release notes record behaviour and docs changes only, never a credit list. Commit identity is handled by the maintainer at landing time, so no adjustment is needed in the PR.

## Security

Report issues through the private channel in [SECURITY.md](SECURITY.md), not through a public issue or PR.
