# Security policy

[中文](SECURITY.md)

## Reporting a vulnerability

Please do not report security issues through public issues. Use GitHub's private reporting channel:

<https://github.com/chromoany/dsh-notify-me/security/advisories/new>

Include the plugin version, the DSH version and runtime (web or desktop), reproduction steps, and the impact the issue allows. Remove external push URLs, access tokens, session titles, and message text before attaching logs or `debug()` output.

## Version scope

Only the latest published release (currently 1.14.x) is accepted. For older builds, upgrade and retest first. Issues in the host or the Electron shell belong to the upstream project.

## Data the plugin handles

- Alerts contain the session label, the first 160 characters of a pending approval or question, and the first 80 characters of a reply. By default they are presented locally only: OS notification, sound, tab title.
- When external push is enabled, that text is sent to endpoints the user configured; URLs and secrets are stored in browser local storage. The plugin runs no backend service, collects no usage data, and forwards nothing to other third parties.
- When a desktop notification is clicked, on Windows the host runs PowerShell to raise the window; on macOS / Linux the page fires the `dsh://open` deep link and the host is not involved. The host route accepts a loopback peer and a loopback `Host`, or the exact address the listener itself is bound to; when an `Origin` is present it must match that `Host`, and a dedicated request header is required.
- With the host-side fallback enabled, the same session label and approval text are sent by the host process to a gateway you configured. The gateway credentials live in a mode-0600 JSON file owned by the host user (`{user, password}` sent as HTTP Basic, or `{authorization}` sent verbatim): they never reach the browser, never go into the profile's patch layer, and are never echoed into a response or a log line; a 401 / 403 from the gateway re-reads that file once. The host entry points (the page bridge route, the relay's `POST`, the health probe) share one gate: the peer must be loopback or the exact address the listener is bound to, the `Host` must be a loopback name, that bind address, or a public name derived from `allowedOrigins`, and an `Origin`, when present, must either be in `allowedOrigins` or agree with that `Host`.
- A "custom" target that names the relay's upstream gateway is folded onto the relay route: this only sends the same alert down a same-origin path (with the host adding the credential) and **never to a new destination** — the fold requires the target's host to equal `relay.upstreamHost`, which is already public in the configuration, and `host-bridge` publishes that host name alone, never the credential or the path token.
- The same-origin relay's route path is a credential: whoever knows it can make the host send a notification on their behalf (the gateway credentials are still added by the host, never exposed to the page). Keep a random token in the path and treat it like a password. The relay's `GET` / `HEAD` is a read-only probe that forwards nothing and carries no credential, but it goes through the same gate as the writing request; the probe only answers `{ok, route, version, enabled}`.

## In scope

Bypassing the raise-window route, bypassing the relay's capability path (a request forwarded without passing the gate or the credentials, or a path that is routed around), a coordination defect that makes the host-side fallback deliver a duplicate while the page still holds its lease, credentials appearing in logs or `debug()` output, insufficient validation of external push URLs, unexpected files in the published npm package.

## Out of scope

Issues that require the user to modify the console or localStorage by hand first, defects in browsers or the notification systems themselves, vulnerabilities in third-party push services.

## Response time

The repository is maintained by a single person. Vulnerability reports usually receive a reply within one week; fixes are recorded in the CHANGELOG.

## Handling credentials

External push URLs and access tokens are credentials. Do not include them in issues, screenshots, or public records. The host-side fallback's gateway credentials file and the same-origin relay's route path count as credentials too.
