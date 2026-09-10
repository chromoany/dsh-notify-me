# Changelog

All notable changes to **dsh-notify-me** are documented here.

## [未发布]

### 文档
- 新增 `docs/listing.md`：记录各插件目录/市场的收录方式（提交物、合并方式），以及本插件当前的收录状态；并记下 `awesome-dsh-plugin` 站点构建失败的排查入口（`build-site.yml` 最近一次运行 / issue #4731）。

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

[1.1.3]: https://github.com/chromoany/dsh-notify-me/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/chromoany/dsh-notify-me/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/chromoany/dsh-notify-me/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/chromoany/dsh-notify-me/releases/tag/v1.1.0
