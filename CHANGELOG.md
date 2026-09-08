# Changelog

All notable changes to **dsh-notify-me** are documented here.

## [1.0.1] — 2026-09-08

### Changed
- README is now **简体中文-primary** homepage with a `简体中文` homepage plus an English version (`README.en.md`), plus this changelog, mirroring the ecosystem's documentation conventions.
- `package.json`: added `publishConfig.access: public`, `repository`/`homepage`/`bugs` links, and added `README.en.md` + `CHANGELOG.md` to the published `files` set.

## [1.0.0] — 2026-09-08

### Added
- First release. Browser-layer desktop reminder plugin for the DeepSeek Harness web UI.
- 🔔 **Needs-your-input alerts**: fires on new pending interactions — sandbox `approval`, `plan-review`, and `question` (`ask_user_question`) — with toast + sound + `🔔 需要你 ·` tab-title marker (alerts even while the page is visible).
- ✅ **Reply-finished alerts**: detects the selected session's `running: true → false` edge (and background sessions' completion) — toast + sound, by default only while the page is hidden/backgrounded.
- Clicking a toast focuses the DSH window.
- Zero-UI, zero-server-logic: pure client-side bundle subscribing to the `sessions` service; preferences in `localStorage`; auditable, self-contained code (`<20 KB`).
- Offline smoke test (`smoke/smoke-test.cjs`) covering the alert state machine.\n- Screenshot + `screenshots.json` for the plugin-market page; UI preview shown in the README.

<!-- versions -->
[1.0.1]: https://github.com/chromoany/dsh-notify-me/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/chromoany/dsh-notify-me/releases/tag/v1.0.0
