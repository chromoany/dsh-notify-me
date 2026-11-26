# 开发自检

本文件是 `README` 里「开发自检」一节的完整版：命令之外的套件覆盖范围、手动检查与排障细节。

```sh
node --check lib/client.js
node --check lib/index.js
npm test                         # smoke-test（状态机）+ host-route-test（宿主半路由）+ page-bridge-test + host-fallback-test + relay-route-test + cordis-host-test + mac-notify-test + mac-notify-content-test + win-toast-test
npm pack --dry-run               # 预览发布包
```

## 各测试套件覆盖范围与手动检查

`smoke/smoke-test.cjs` 是离线状态机测试：三代宿主 + 主开关 + 语言五档用例 + 快捷裁决桥（Service Worker 半侧一并跑）+ 闲置判定与通知自收 + 回到页面即收起残留通知 + 通知标签长度收口 + 页面侧 host-bridge 探测/心跳/释放与 `debug().hostBridge` 形状 + 外部推送（含 Telegram 的报文形状、`ok` / `error_code` 判决、429 与 5xx 重试、4096 截断、半配置目标被剪掉、设置页的令牌与聊天 ID 输入框）+ Goal 中间轮不报「回复完成」（有 Goal 投影时静默、Goal 停后报最后一条、没有投影的老宿主照旧报），外加两条桌面原生通道用例——Windows 原生审批 Toast 正文点击只走宿主 focus 路由才切会话（无 session 时只抬窗不切），macOS 前台点击只靠 1 秒轮询切会话并在读走后停止。角标用例按会话计数：两个等待会话报 2、同一快照重复不重画、当前会话不算、静音或关掉开关归零、宿主没有 `setAppBadge` 时静默不报错。`dockBadgeHostFailures()` 再补一组失败面：宿主快照抛异常时设置页开关照样生效、错误记进 `debug().dockBadgeError`、存储恢复后重画真数，只暴露 `setAppBadge` 的宿主改用它清零。它还钉住清单：`package.json` 的 `dsh.client.inject` 必须为空、运行时那句 `inject = ["sessions", "locale", "slots"]` 必须原样保留（[#44](https://github.com/chromoany/dsh-notify-me/issues/44)：加载器把清单读成「先到达这些整包」，目标到不了，整个条目静默不跑）。`smoke/host-route-test.mjs` 不需要本机 DSH，`lib/index.js` 的路由、探针与 403/405/501 闸门在任何平台都会跑。

新增的三个套件同样自带假 `ctx`、不联网、不需要本机 DSH：`smoke/page-bridge-test.mjs` 跑页面桥接路由的状态回包形状、心跳与释放、缺意图头 `403`、跨源 `403`、坏 JSON `400`、超长 `413`，以及 `allowedOrigins` 派生的 `Host`（模拟隧道）放行与路径冲突；`smoke/host-fallback-test.mjs` 跑宿主兜底——审批去重、`turn/end` 节流、子代理跳过、Goal 还 `active` 时中间轮不投递（`complete` / `pause` / `block` 之后照常投递，重启后能从会话日志里补出 Goal 状态）、租约新鲜时不发、租约过期后发、`alive:false` 后立刻发、语言跟随心跳、401 后重读凭据、健康探针；`smoke/relay-route-test.mjs` 跑中继——`GET` 探针、`405`、跨源 `403`、`413`、`400`、`503`、`200` / `502` 映射与「401 只重试一次」、`relay.bodyTemplate` 的模板渲染与 JSON 转义、坏模板启动即不注册、渲染体积上限；1.24.0 又加了两组：完成提醒的正文由宿主从会话日志补齐（保留换行、夹紧后截断、页面已给多行正文不覆盖、`attention` 不动），以及 `snippetLimit: 0` 时只转会话名、从公网名字进来的请求过了闸门也不读日志。

`smoke/mac-notify-test.mjs` 跑 macOS 通知路由：只在 macOS 桌面宿主注册、探测、`405` / `403` / `501` / `400` 的拒绝、传给助手的参数（含 `--id` / `--sound` 与 `{remove:id}` 撤回）、点击回传只被取走一次。它用假的平台与 Electron 版本号驱动，不需要真的编译助手，在任何平台都会跑。

`smoke/mac-notify-content-test.mjs` 跑通知内容：`splitNotificationBody()` 对每一种正文形状的结果（一行、两行、空行、首尾空白、CJK、缺字段）、页面自己抬好的 `subtitle` 优先生效、只有真有副标题时才传 `--subtitle`、正文永远不等于标题（回归）、回复摘要怎么从事件日志里取（跳过工具结果、压成一行、超长截断加省略号、空日志不报错、只在 `done` 且正文为空时读）、读日志失败仍照发提醒、以及拆分后再各自截断（正文 1000 字符、副标题 200 字符）。同样用假 spawn，不需要真的助手，在任何平台都会跑。

语言各档与 Android 退路各自有独立用例：`smoke/smoke-test.cjs` 的 `languageModes()` 走 `auto` 的两条识别来源（宿主 locale 与 `document.documentElement.lang`）、`zh-TW` / `zh-HK` / `zh-MO` / `zh-Hant` 都算繁體、`zh-CN` 仍是简体、插件没有语言包的界面标签（`ja` / `de`）按英文、页面上毫无语言信号才回落简体、钉死某一档后通知与设置页都跟着变、四份字典键集完全一致；`androidWorkerFallback()` 三条：Android UA 下 `new Notification` 一次都不碰、只注册一个 Service Worker、通知参数（tag / renotify / silent / data）与「只注册一次」；桌面 UA 下构造器抛 `Illegal constructor` 时先照常调用、再回落 Worker 并记住失败；Worker 也拒收时错误进 `debug().lastToastReject` 而不是被吞。`smoke/page-bridge-test.mjs` 另钉住心跳带 `zh-TW` 被接受、未知语言被忽略、宿主兜底文案与 `pickLanguage` 的优先级。

`smoke/win-toast-test.mjs` 跑 Windows 原生 Toast 路由：Windows 桌面门控、`GET` 探针、`405` / `403` / `501` / `400` 的拒绝、审批 payload 与 base64 传递、首次发 Toast 前的六条注册命令（`HKCU\Software\Classes\dsh-notify-me` 的三条协议键、`AppUserModelId\dsh-notify-me` 的 `DisplayName` 与 `CustomActivator`、以及只建不写 `LocalServer32` 的空 `CLSID\{…}` 存根）、Windows 10 分支再测七条注册（多出指向 `lib/win-toast-activator.ps1` 的 `LocalServer32`）、payload 里的 `comActivation`、以及激活器回调的 `LPWStr` 封送注解；approve / reject / open 动作单次认领、token 过期与 `{remove}` 撤回。它用假的 `spawn` 驱动 `reg.exe` / `powershell.exe`，不需要真的 Windows 桌面宿主。另外断言处理器脚本是 UTF-16LE + BOM、正文纯 ASCII、含 `ExpandEnvironmentStrings` 表达式、不烘入 profile 路径，且正文点击只发 `dsh-notify-me://open`（不得再出现 `dsh://open`）；`dsh-notify-me://open` 不带 session 时仍解析为一次纯抬窗（[#40](https://github.com/chromoany/dsh-notify-me/issues/40)）。

改到 `lib/focus-window.ps1` 时（仅 Windows），另需手动跑一次：

```powershell
powershell -NoProfile -File lib/focus-window.ps1 -ProcessId 0   # 末行应是 FOCUSED=1
```

`cordis-host-test.mjs` 会从本机 DSH 安装借 `@deepseek-ai/cordis`（依次探测 npm 全局目录、`~/.dsh/profiles/web/node_modules` 与 `~/.dsh/profiles/node_modules` 平铺回退目录）；源码 checkout 里没有 profile 依赖时，用 `DSH_CORDIS_PATH=<checkout>/vendor/cordis/lib/index.js` 指定即可。
