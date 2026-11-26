# Расширенная настройка через консоль

Главная точка входа — страница настроек; если нужно менять параметры скриптом, пакетно или сбрасывать их к значениям по умолчанию, они хранятся в `localStorage` (`dshNotifyMe.config`) и подстраиваются на лету из консоли:

<details>
<summary>Справочник по API консоли и хранилищу</summary>

```js
window.__dshNotifyMe.config                       // view current config
window.__dshNotifyMe.setConfig({
  enabled: true,           // false = disable all reminders (master switch)
  language: "auto",        // 'auto' follow the UI | 'zh' Simplified Chinese | 'zh-TW' Traditional Chinese | 'en' English | 'ru' Russian
  attentionHiddenOnly: false, // true = don't alert "needs you" while the page is visible
  currentHiddenOnly: true,    // true = waits in the conversation on screen keep only the title marker (replayed once away)
  donePolicy: "background",   // "reply finished" policy: 'background' only when away | 'smart' quiet only for the open one | 'always' always alert
  idleMinutes: 3,             // minutes without keyboard/mouse input before "away" counts (0 = turn the idle rule off)
  autoDismiss: "present",     // toast auto-dismiss (the timer only; leftovers are withdrawn once you are back unless keepOnReturn is true): 'present' keep while away | 'always' always close | 'never' never close
  keepOnReturn: false,        // false = withdraw the leftovers when you come back; true = keep them until you dismiss or click Close
  ignoreSubagent: true,       // true = no alerts for background subagent sessions (the open one still alerts)
  mutedSessions: [],          // session ids muted per conversation (written by the sidebar bell or the right-click menu, survives reloads)
  muteRowButton: true,        // true = show the mute bell in the row hover strip; false = right-click menu only (a muted row keeps its bell)
  sound: true,                // sound switch (also governs the "system notification sound" mode)
  soundDone: "synth",         // "reply finished" sound source: 'synth' built-in | 'custom' picked file | 'system' OS notification sound
  soundAttention: "synth",    // "needs you" sound source, same values
  volume: 0.5,                // volume 0..1
  autoFocus: true,            // a toast click returns to the conversation that raised it
  quickActions: true,         // Approve / Reject buttons on approval toasts
  hostEnv: "auto",            // runtime: 'auto' detect | 'desktop' force the app | 'web' force the browser
  externalEnabled: false,     // external forwarding master switch (default off: no endpoint, nothing is sent)
  externalAttention: true,    // forward "needs you" (exactly the same trigger rules as local alerts)
  externalDone: true,         // forward "reply finished"
  externalRetryDelays: [2000, 6000], // backoff for retryable failures (ms, with jitter; [] = send once)
  externalTargets: []         // push targets, see the field notes below
})
// Target shape: {id, type, url, secret?, token?, uid?, botToken?, chatId?, template?, enabled?}
// type: 'discord' | 'bark' | 'gotify' | 'feishu' | 'serverchan' | 'wxpusher' | 'telegram' | 'custom'
// token/uid only for wxpusher (its URL is fixed to the official endpoint); botToken/chatId only for
// telegram (its URL is built from the token); secret signs Feishu bodies
// and custom HMAC headers; template is optional ({{title}} {{body}} {{event}} {{time}} {{session}});
// enabled:false disables that one target
window.__dshNotifyMe.resetConfig()                // restore defaults (also drops any picked audio files)
window.__dshNotifyMe.decide("approval:3", "allowed-once")  // programmatic decision: "allowed-once" | "rejected"
window.__dshNotifyMe.testExternal()               // explicit outbound test to valid targets; resolves {sent, unverified, failed, statuses}
```

> **Граница переключателей при тесте внешних уведомлений:** кнопка «Отправить тестовое уведомление» на странице настроек требует включённых главных переключателей «Включить напоминания» и «Внешние уведомления», но переключатели пересылки по видам игнорирует. Вызов `testExternal()` из консоли — явный тест: если валидные адреса настроены, он отправит на них сообщения даже при выключенных главных переключателях; если валидных адресов нет, не уйдёт ничего. Обычные вызовы `test("done")` / `test("attention")` / `test("approval")` проверяют только локальные уведомления и наружу ничего не пересылают.

> Строка «Уведомлять и на переднем плане (один переключатель)» в верхней части карточки «Когда уведомлять» на странице настроек — не отдельный ключ конфигурации: это производное представление значений `attentionHiddenOnly: false`, `currentHiddenOnly: false` и `donePolicy: "always"`. Если изменить любой из этих трёх параметров по отдельности, строка тоже изменится; выключение строки восстанавливает `attentionHiddenOnly: false`, `currentHiddenOnly: true` и `donePolicy: "background"`.

> Выбранные аудиофайлы хранятся не в `dshNotifyMe.config`: для каждого вида звука отводится свой ключ (`dshNotifyMe.sound.done` / `dshNotifyMe.sound.attention`, внутри — data URL вида `{name, size, data}`), потому что при превращении файла в data URL его размер растёт примерно в 1,37 раза, а в конфигурации это замедляло бы каждое чтение. `resetConfig()` очищает оба этих ключа вместе с конфигурацией.
>
> Чтобы понять, какой источник звука действует на самом деле, посмотрите `soundDone` / `soundAttention` и `customSoundDone` / `customSoundAttention` в `window.__dshNotifyMe.debug()`.
>
> `macNotify` — это не страничная настройка в `localStorage`, а конфигурация уровня profile patch в записи `- id: notify-me`: `macNotify: { enabled: false }` отключает нативные уведомления macOS Desktop, а `macNotify: { appPath: "/path/to/DSH Notify.app" }` указывает на помощник, собранный в другом месте (по умолчанию используется тот, что входит в пакет). `debug().macNative` сообщает, идёт ли эта страница по такому каналу; `debug().macNativeLast` — результат последней доставки.

> `winToast` — конфигурация того же уровня profile patch: `winToast: { enabled: false }` отключает нативные Windows-уведомления, которые отправляет хост (одобрения с кнопками «Одобрить» / «Отклонить», «нужен ответ» и «ответ готов» без кнопок), и возвращает страницу к её собственному каналу уведомлений для всех трёх видов (у одобрений не будет кнопок). При первом нативном уведомлении хост попутно записывает идентичность уведомления и `IconUri` в `HKCU\Software\Classes\AppUserModelId\dsh-notify-me` и регистрирует обработчик протокола в `HKCU\Software\Classes\dsh-notify-me` (он записывает нажатое действие обратно на эту машину и ничего не запускает); права администратора для этого не нужны, а установки, где такие уведомления не появляются вовсе или где используется только локальная страница `dsh-app://`, регистрацию не запускают. `debug().winNative` сообщает, идёт ли эта страница по такому каналу; `debug().winNativeLast` — результат последней доставки или действия.

> `debug().hostBridge` — доступный только для чтения снимок координации с хостом: `state` (`idle` — проба ещё не ответила; `active` — у хоста есть резервная отправка, и страница удерживает аренду своими heartbeat-сигналами; `unavailable` — хост есть, но резервной отправки не предлагает (так выглядит установка по умолчанию; незарегистрированный маршрут, отвечающий 404, тоже относится к этой категории и сбоем не считается); `error` — хост не дал пригодного ответа или шлюз отклонил страницу сразу), `leaseMs` (аренда, выданная хостом, в миллисекундах), `relayEnabled` и `relayPath` (маршрут ретранслятора, если хост его включил), `relayUpstreamHost` / `relayUpstreamPath` (имя хоста и путь вышестоящего шлюза ретранслятора, то есть того адреса, при совпадении с которым отправка уходит через ретранслятор), `lastReason` (причина сбоя последней пробы: `bad-host` / `cross-origin` / `http-403`; `null`, если сбоя не было) и `lastProbeAt` / `lastBeaconAt` (время последней пробы и последнего heartbeat в виде строк ISO либо `null`). Отказ шлюза читается как `error`, а не как «выключено», потому что это конфигурация, которую пользователь может исправить сам: добавьте origin этой страницы в `allowedOrigins` верхнего уровня записи `- id: notify-me` в профиле.

</details>

---

[← Назад к README](../README.ru.md)
