# Changelog

All notable changes to **dsh-notify-me** are documented here.

## [1.1.6] — 2026-09-24

### 修复
- **1.1.5 的「模型在等你操作」修复在真机上从未生效**（现象与 1.1.5 条目描述的一模一样：审批卡片出现、模型停下等待时，没有系统通知、没有提示音、标签页标题也不变；而「回复完成」提醒和设置页的测试按钮一切正常）。根因是**取服务的方式**：`bindUiSession()` 用 `rootCtx.uiSession` 属性读取，而 **cordis 4 只解析写在插件 `inject` 映射里的服务名**，其余名字一律抛 `cannot get property "uiSession" without inject`——同一 fiber 的兄弟条目（`dsh-client-ui-session`）提供的服务不会出现在祖先 store 里，属性查找必然落空；外层那个 `try/catch` 把这个异常吞成 `svc = null`，订阅永不建立，而 `0.1.2+` 的旧快照路径已经没有 `pending` 可用，待办提醒因此全程哑火。
  - 改用 **`ctx.get("uiSession")`**：这是 cordis 明文的「无需 inject 读取服务」通道；`ctx.reflect.get()` 与属性读取保留为该 API 之前的兜底。服务实例被换掉时（插件 HMR）也会重新绑定，而不是抱着旧 store 的失效订阅。
  - **仍然不把 `uiSession` 写进 `inject`**：那会让本插件在所有 `0.1.2-alpha.2` 之前的宿主上永远停在 `pending`（1.1.4 踩过的坑），而 cordis 的 `inject` 只有「必需」一种语义，没有可选依赖。

### 新增
- **`window.__dshNotifyMe.debug()`**：输出当前绑定状态（`uiSession: bound|unbound`、失败原因 `uiSessionNote`、会话基线与待办基线数量、已提醒 key、通知权限、页面可见性、最后一次提醒时刻）。这条链路失败时原本没有任何可见信号，排查只能翻宿主源码——这正是本次要补上的东西。
- 服务「已被某个条目提供、却拿不到」时打一条 `console.warn`；旧宿主根本没有该服务属于正常情况，保持安静。

### 变更
- 新增 `smoke/cordis-host-test.mjs`：用**真正的 cordis 4** 起根上下文、由兄弟插件提供 `uiSession`，把 `lib/client.js` 真身挂上去端到端验证。先断言宿主语义本身（属性读取必抛 `without inject`、`ctx.get()` 必能解析），再驱动一次 `approval` 交互，断言弹出提醒（标题「DSH · 审批请求」、正文带 `toolName · reason`）、标题标记、同 key 不重复、交互消失后释放标记；最后再跑一遍无 `uiSession` 的旧宿主路径。找不到本机 DSH 安装时自动跳过。
- `npm test` 现在依次跑 `smoke/smoke-test.cjs` 与 `smoke/cordis-host-test.mjs`。

### 更正
- 1.1.5 条目里「本版改为订阅该 store」的结论不成立：订阅从未建立。1.1.5 的测试之所以通过，是因为 `smoke/smoke-test.cjs` 传入的是**手写假 ctx（普通对象）**，`ctx.uiSession` 属性读取不经过 cordis 的 inject 门控——假 ctx 上的成功掩盖了真宿主上的失败。教训：用真宿主语义的 ctx 跑插件真身，比手写桩更能说明问题。

### 文档
- 新增 `docs/listing.md`：记录各插件目录/市场的收录方式（提交物、合并方式），以及本插件当前的收录状态；并记下 `awesome-dsh-plugin` 站点构建失败的排查入口（`build-site.yml` 最近一次运行 / issue #4731）。
- issue #1 / #2 报告的「等待审批 / 提问 / 方案确认不提醒」：1.1.5 判对了病因、开错了药（见上），1.1.6 才是真正生效的修复。

## [1.1.5] — 2026-09-14

### 修复
- **「模型在等你操作」这一路提醒在 DSH `0.1.2-alpha.2` 及以后的运行时上完全不触发**（现象：审批卡片出现、模型停下等待时，没有系统通知、没有提示音、标签页标题也不变；而「回复完成」提醒一直正常）。根因是两个待办数据源同时被上游搬走：
  - 选中会话的快照 —— `SessionSnapshot.pending` 已不存在（0.1.2-alpha.2 起只剩 `queue / pendingSubmissions / running / …`）；
  - 会话列表行摘要 —— `SessionSummary.pendingInteraction` 已不存在（只剩 `running / completed`）。

  待办交互改为由 `dsh-client-ui-approval` / `dsh-client-ui-user-questions` 经 `ctx.uiSession.registerPendingInteraction()` 发布到**独立 store** `ctx.uiSession.pendingInteractions`（`Map<sessionId, interaction>`，`interaction.kind` 为 `approval | question | plan-review`）。本版改为订阅该 store：新出现的交互弹一次提醒（`PendingApproval` 取 `toolName` / `reason`，`PendingQuestion` 取 `questions[0].question`），交互消失时释放标签页标记，挂载时已存在的等待也提醒一次。
  - **为什么不把 `uiSession` 写进 `inject`**：客户端条目的 `inject` 是**硬门控**——服务不存在时条目会永远停在 `pending`，而 web 启动断言会因「有条目未激活」直接抛错（这正是 1.1.3/1.1.4 两次踩过的坑）。`uiSession` 只存在于 `0.1.2-alpha.2` 及以后，写进 `inject` 会让本插件在 `0.1.1-rc.2` 上彻底失效。因此改为**惰性查找**：拿得到就订阅交互 store，拿不到就静默走旧的快照路径，两代宿主都保留完整功能。
  - 保留 `@deepseek-ai/dsh-client-ui-session` 在 `dsh.client.inject` 中（它是客户端加载图里的 bundle 条目，与服务门控无关）；实测该条目在加载图顺序上位于 `@deepseek-ai/dsh-client-ui-session` 之后（54 个条目中第 44 位 vs 第 10 位），且官方 `dsh-client-ui-approval` / `dsh-client-ui-user-questions` / `dsh-client-ui-open-in-app` / `dsh-client-ui-layout` 等同样以 `"uiSession"` 为服务依赖。

### 变更
- 两条来源同时可用时按交互 key 去重：同一次等待只提醒一次、也只有一个标签页标记；标题标记的归属固定给交互 store（可用时），避免两路各记一个标记。
- 测试：`smoke/smoke-test.cjs` 拆成**两代宿主**各跑一遍——旧宿主（无 `uiSession`，快照带 `pending`）与新宿主（`uiSession.pendingInteractions`），新增「重复通知不重复提醒」「挂载前已存在的等待仍提醒一次」「多会话并发等待各提醒一次并逐个释放标记」「两路去重」「主开关关闭时交互通道同样静音」等回归用例。

## [1.1.4] — 2026-09-13

### 修复
- **插件在 DSH `0.1.2-rc.1` 及以后的运行时上一直没有真正激活**（表现为：桌面端/网页端都不弹提醒、设置里也没有「通知提醒」分区，而启动清单里又能看到条目）。根因是 `dsh.client.inject` 里残留了 `@deepseek-ai/dsh-client-runtime`：该包从 `0.1.2-rc.1` 起已从官方客户端依赖图移除（`sessions` 服务改由 `@deepseek-ai/dsh-client-ui-session` 提供），而客户端条目的 `inject` 目标是**硬门控**——解析不到就停在 `pending (waiting for services: …)`，`apply` 永不执行。1.1.3 为兼容 0.1.0/0.1.1 线而保留该条目，正是这一处让插件在 0.1.2-rc.1 起的版本上全程哑火。
- 相应地，`dsh.client.inject` 现在只保留 `@deepseek-ai/dsh-client-ui-session` / `@deepseek-ai/dsh-client-locale` / `@deepseek-ai/dsh-client-ui-conversation` 三个官方包。

### 变更
- 兼容声明补到实测激活的 `0.1.5-rc.1` / `0.1.5-rc.2`（DSH Desktop 2.0.9 内置 0.1.5-rc.2 线）；`peerDependencies` 范围同步放宽到 `^0.1.5-rc.1`。
- 兼容性验证口径改为**「插件真的激活」**：在独立 `DSH_HOME` + 独立 profile 里启动目标版本，检查设置页出现本插件注册的「通知提醒」分区，而不只是看启动清单里有没有这个条目。

### 更正
- 1.1.3 的验证记录不成立：当时只确认了「条目进入 `__DSH_BOOT__`、`/plugins/??dsh-notify-me/client.js` 返回 200」，**没有验证插件是否被激活**，因此 `0.1.2-rc.1: compatible` 的声明与事实不符（该版本上插件同样被同一处 inject 门控）。同版条目里「原条目保留，供 0.1.0/0.1.1 线使用」的判断作废——保留即致命。

## [1.1.3] — 2026-09-09

### 新增
- **逐版本兼容声明**：`package.json` 增加 `dsh.compatibility.dshReleases`，声明 `0.1.1-rc.2` 与 `0.1.2-rc.1` 为 `compatible`（DSH-Store 目录用该矩阵决定条目是否保持上架）。
- **0.1.2-rc.1 实测记录**：用独立的 `DSH_HOME` + 临时 profile 启动 0.1.2-rc.1 的 web 应用，插件客户端模块进入 `__DSH_BOOT__`（47 个条目之一），`/plugins/??dsh-notify-me/client.js` 返回 200 且按 `__ModuleLoader__.load` 注册；运行时需要的 `sessions`（0.1.2 起由 `dsh-client-ui-session` 提供）、`locale` 与 `slots`（`dsh-client-locale`）三个服务均存在。

### 变更
- `dsh.client.inject` 补上 `@deepseek-ai/dsh-client-ui-session`：0.1.2-rc.1 已移除 `@deepseek-ai/dsh-client-runtime`，`sessions` 服务改由前者提供（原条目保留，供 0.1.0/0.1.1 线使用）。
- `peerDependencies` 由 `@deepseek-ai/dsh-client-runtime` 改为实际依赖的 `@deepseek-ai/dsh-client-locale`，范围扩到 `^0.1.2-rc.1`；仍为 optional。

## [1.1.2] — 2026-09-08

### 变更
- **README 新增「为什么需要它」**（中英双语）：把定位写清楚——不开完整访问要付「等待」成本，开了要付「不可逆风险」成本；插件把「监督」与「守在屏幕前」解耦，**让你敢不开完整访问**，并注明它不降低 full access 本身的权限风险（它不是沙箱）。
- README 预览图改用绝对地址：`docs/` 不在发布文件集内，相对路径在 npm 页面会裂；简体版补齐 bundle 体积 badge，与英文版对齐。
- 中文正文标点统一：半角 `;` → `；`，直引号 `"…"` → `「…」`。
- 仓库新增 `.gitignore`（`node_modules/`、`.npm-cache/`、`*.tgz`）。

### 修复
- `window.__dshNotifyMe.version` 与包版本脱节（停在 `0.2.0`），现随 `package.json` 同步为 `1.1.2`。
- `CHANGELOG` 1.0.0 条目中的字面量 `\n`（页面上会渲染成 "\n"）改为真实换行；1.0.1 条目英文措辞自相矛盾处修正；版本链接修正为真实存在的目标（1.0.0 / 1.0.1 没有对应 git tag，原链接 404）。

## [1.1.1] — 2026-09-08

### Fixed
- **测试按钮不再被「页面打开时也提醒」开关吞掉**：页面可见且「回复完成」保持默认（仅后台提醒）时，点「测试「回复完成」」现在会正常弹出提醒——测试路径改为绕过可见性规则（只受主开关与浏览器通知权限影响），并补上对应的回归用例。
- 「需要你」测试提醒的标签页标记约 6 秒后自动消失，不再留下一个看起来像「真有待办」的常驻标记。

## [1.1.0] — 2026-09-08

### Added
- **设置入口**：DSH web 的 **设置 → 通知提醒** 新增独立设置页（`settings.section` 槽位，浏览器半身可选 React 呈现，缺失能力时自动降级为纯提醒）：主开关、系统通知/提示音/音量、两种场景的可见时提醒开关、点击通知聚焦开关，以及 **通知语言**（跟随界面 / 简体中文 / English）与一键测试、恢复默认。
- **通知语言**：提醒文案（通知标题/正文/`🔔 …` 标题标记）不再硬编码中文——`language` 配置支持 `auto`（跟随 DSH 界面语言）/ `zh` / `en`；页面重新加载后按需即时解析。
- **总开关**：`enabled` 配置（默认开），关闭后不发通知、不响铃、不改标签页标题。
- **可发现性**：`package.json` 新增中英关键词（消息提醒 / 可操作提醒 / 桌面通知 / 需要你操作 / 回复完成提醒 / 后台完成提醒 / desktop-notification / message-alert / approval-alert 等），description 与 README 首页同步补齐搜索词。

### Changed
- `lib/client.js` 重写：提醒核心保持零第三方依赖与自包含；新增语言解析/多语言文案表与可选 Settings 页面（依赖 `slots`/`locale`/`react`，注册前做能力守卫）。
- 冒烟测试扩展：覆盖主开关、`language` 中英切换后的通知文案与标题标记、`resetConfig` 恢复新增默认项。

## 1.0.1 — 2026-09-08

### Changed
- README is now a **Simplified-Chinese-primary** homepage (`README.md`) with a parallel English version (`README.en.md`) and this changelog, mirroring the ecosystem's documentation conventions.
- `package.json`: added `publishConfig.access: public`, `repository`/`homepage`/`bugs` links, and added `README.en.md` + `CHANGELOG.md` to the published `files` set.

## 1.0.0 — 2026-09-08

### Added
- First release. Browser-layer desktop reminder plugin for the DeepSeek Harness web UI.
- 🔔 **Needs-your-input alerts**: fires on new pending interactions — sandbox `approval`, `plan-review`, and `question` (`ask_user_question`) — with toast + sound + `🔔 需要你 ·` tab-title marker (alerts even while the page is visible).
- ✅ **Reply-finished alerts**: detects the selected session's `running: true → false` edge (and background sessions' completion) — toast + sound, by default only while the page is hidden/backgrounded.
- Clicking a toast focuses the DSH window.
- Zero-UI, zero-server-logic: pure client-side bundle subscribing to the `sessions` service; preferences in `localStorage`; auditable, self-contained code (`<20 KB` at 1.0.0).
- Offline smoke test (`smoke/smoke-test.cjs`) covering the alert state machine.
- Screenshot + `screenshots.json` for the plugin-market page; UI preview shown in the README.

<!-- versions -->
> 1.0.0 与 1.0.1 早于本仓库的 GitHub 标签历史（tag 从 `v1.1.0` 起，且 npm 上只有 1.0.0 / 1.1.0 / 1.1.1），故不附链接。

[1.1.4]: https://github.com/chromoany/dsh-notify-me/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/chromoany/dsh-notify-me/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/chromoany/dsh-notify-me/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/chromoany/dsh-notify-me/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/chromoany/dsh-notify-me/releases/tag/v1.1.0
