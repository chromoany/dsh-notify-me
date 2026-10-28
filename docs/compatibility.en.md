# Compatibility

Per-release adaptation records live in [package.json](../package.json) under `dsh.compatibility.dshReleases`; hosts from `0.2.1-rc.2` on gate installation on `peerDependencies` and `engines` only and no longer read that field, so it is a human-readable record, not a gate.

Every release was tested to **actually activate**: `0.1.1-rc.2`, `0.1.2-rc.1`, `0.1.5-rc.1`, `0.1.5-rc.2`, `0.2.0-rc.2`, `0.2.1-rc.2`, `0.2.1-rc.3`, `0.2.1-rc.4` and `0.2.2-alpha.2` (the criteria: the plugin entry lands in the boot page's `__DSH_BOOT__`, its inject dependencies resolve, `/plugins/??dsh-notify-me/client.js&rev=…` serves a build containing the new code, and the "Notify me" section appears in Settings). Plugin entries stay compatible from `0.1.1-rc.2` through `0.2.2-alpha.2`, and stepping back to an older host needs no config change; the `1.9.0` settings redesign added no new host API, and the bell in the settings page header is the plugin's own SVG (`docs/brand/`).

<details>
<summary>Host-generation shape differences and two known traps</summary>

The plugin picks its interaction source per host generation; the table below marks the boundaries of each shape, not a gate:

| Host generation | "Needs you" interaction source | Current session | Toast-click navigation |
| --- | --- | --- | --- |
| `<= 0.1.2-alpha.1` | controller snapshot `pending[]` | snapshot `current` | `sessions.open()` |
| `0.1.2-alpha.2 .. 0.1.6-alpha.1` | `uiSession.pendingInteractions` | snapshot `current` | `sessions.open()` |
| `>= 0.1.6-alpha.2` (incl. `0.2.0-rc.2`, `0.2.1-rc.2`, `0.2.2-alpha.2`) | `uiSession.sessionStatus` | `retainedBy.mainView` | `uiWorkspace.openSession()` |

The ranges are illustrative: the plugin picks its source by store shape (whenever `sessionStatus` exists it takes the new path), and the version numbers only mark where each shape appeared. The `peerDependencies` range shapes npm's peer warning — `0.2.1-rc.2` and `0.2.2-alpha.2` both fall inside `>=0.2.0-rc.1 <0.3.0-0`, so no exemption is needed.

`0.2.1-rc.3`, `0.2.1-rc.4` and `0.2.2-alpha.2` each got an isolated run: an isolated `DSH_HOME` with the plugin installed, then `dsh web --no-open` (71 boot entries on `rc.3` / `rc.4`, 72 on `0.2.2-alpha.2`), the `dsh-notify-me` entry in the `application` batch, and all three inject targets (`client-ui-session`, `client-locale`, `client-ui-conversation`) present; `/plugins/??dsh-notify-me/client.js` served the 1.16.1 build (248,023 B); loaded into a real page through headless Edge over CDP, `apply` ran normally and `debug()` reported `uiSession: bound`, `uiSessionSource: sessionStatus`, `raiseChannel: window-focus`, and opening Settings from the account menu and clicking "Notify me" rendered the whole settings view. All three ship host client bundles that differ from `0.2.1-rc.2` (`dsh-client-ui-workspace`, `dsh-client-ui-conversation`, `dsh-client-locale`, …), yet every one of the four session-row slots the plugin uses, plus `uiSession.sessionStatus`, `retainedBy.mainView` and `uiWorkspace.openSession()`, is still there; `0.2.2-alpha.2` adds a `sidebar.session.row.trailing` slot the plugin does not use. Host-side shapes still match `0.2.0-rc.2`; no code change was needed.

Two traps are worth remembering: a package listed in `dsh.client.inject` that a newer runtime no longer ships parks the client entry at `pending (waiting for services: …)` forever — which is exactly how 1.1.3 broke on `0.1.2-rc.1` and later; and when the host swaps a store or a field name nothing throws, alerts just go **silent** — `pendingInteractions`→`sessionStatus`, `list.current`→`retainedBy.mainView` and `sessions.open()`→`uiWorkspace.openSession()` were all this kind. So every adaptation has to confirm with `window.__dshNotifyMe.debug()` that it really reports `bound`.

</details>

---

[← Back to README](../README.en.md)
