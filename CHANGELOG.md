# Changelog

All notable changes to **dsh-notify-me** are documented here.

## [1.6.0] — 2026-10-09

### 新增
- **设置页可选音效来源**（`soundDone` / `soundAttention`，「需要你」与「回复完成」各自独立）：
  - `'synth'`（默认）——原有 WebAudio 合成音，行为不变；
  - `'custom'`——自选一个本地音频文件（上限 1 MiB，可试听、可移除），提醒时播放该文件；
  - `'system'`——完全不播插件音效，改为把通知以 `silent: false` 发出，交由操作系统播放它自己的通知音（Windows 通知中心／macOS 通知中心），音色跟着系统通知设置走。
- 设置页新增「音效来源」卡片：两类提醒各一行来源下拉 + 「试听」，选「自定义音频文件」时展开文件选择、已选文件名与体积、「试听」「移除」。
- `window.__dshNotifyMe.debug()` 新增 `soundDone` / `soundAttention`（当前生效来源）与 `customSoundDone` / `customSoundAttention`（该类别是否已存自选文件）。

### 变更
- **通知的 `silent` 不再硬编码为 `true`**：改为 `!systemCue(kind)`。默认两种模式仍是 `silent: true`（插件自己出声，避免与平台提示音叠成两声），只有 `'system'` 模式主动让平台出声。主开关 `sound: false` 仍会连系统通知音一起静音——关掉声音就该是安静的。
- 自选音频存在**独立的 localStorage 键**（`dshNotifyMe.sound.done` / `dshNotifyMe.sound.attention`，值为 `{name, size, data}`），不塞进 `dshNotifyMe.config`：data URL 会膨胀约 1.37 倍，进配置会拖慢每次 `readConfig()`（每次提醒都会调用）。
- `resetConfig()` 与设置页「恢复默认设置」现在**一并清掉**这两个音频键，不再只清配置——否则文件会残留占用 origin 配额，而 UI 上已经没有入口能删它。
- **任何来源取不到声音都回落到内置合成音**（文件缺失、解码/自动播放被拒、超出配额），提醒不会因为音效配置坏掉而变成哑的。
- 版本号 1.5.3 → 1.6.0；`window.__dshNotifyMe.version` 与 `package.json` 同步。
- README（中英）同步：设置清单加「音效来源」，控制台配置块补 `soundDone` / `soundAttention` 与两个存储键的说明。

### 修复
- **「系统通知音」模式下点「试听」不再静默无反应**：该模式本就没有插件可播的音（声音是随通知由系统播放的），而初版实现让试听照样走插件音效通道、在 `'system'` 分支直接返回，按钮看起来就是坏的。现在改为按该类别**发一条测试通知**——你听到的就是它，并在按钮下方写明原因；`sound` 总开关关闭时同样给一句说明而不是静默。

### 测试
- `smoke/smoke-test.cjs` 新增音效来源用例段（**此前音效路径零覆盖**——harness 的 `AudioContext` 是 `undefined`，所有既有用例都静默走了「无音频」分支）：注入可捕获的 `AudioContext` 后，覆盖内置合成音的两种音型（done `659,988`、attention `880,1174,1568`）、`'system'` 不产生振荡器且通知 `silent === false`、`sound: false` 在 `'system'` 模式下重新静音、`'custom'` 播放所存 data URL 且音量跟随滑块、两类来源互不影响、文件缺失时回落内置音、`resetConfig()` 清空两个音频键。
- 同一文件新增设置页渲染用例：`bootBundle` 支持注入 `require`（此前固定返回 `{}`，设置页永不注册、无法被测试），用例断言 `settings.section` 注册成功、「音效来源」两张卡片渲染、`custom` 时才出现文件选择行并显示文件名与体积，以及**按下 `'system'` 行的「试听」确实发出一条 `silent === false` 的测试通知**（为此假 React 改为按索引跨渲染保持 hook 状态，能读到点击后的反馈文案）；默认路径（不注入 react）行为不变。
- `npm test` 两套件均通过；`smoke/cordis-host-test.mjs` 用 `DSH_NODE_MODULES` 指向本机 DSH 安装后**真跑**（此前在多数机器上静默 SKIP），真 cordis 下的 `inject` 语义守卫一并复核通过。

## [1.5.3] — 2026-10-04

### 新增
- **设置页底部常显插件版本号**（`dsh-notify-me v…`，中英跟随界面语言）：报障、核对是否装上新版本时直接照抄这一行，不必再开控制台查 `window.__dshNotifyMe.version`（该字段保留）。

### 变更
- 版本号 1.5.2 → 1.5.3；`window.__dshNotifyMe.version` 同步。
- README（中英）：「桌面端怎么抬窗的 / How the Desktop window gets raised」补真实壳复测结论与触发时机口径——深链必须在带用户手势的处理器里发（通知 `onclick` 自带手势，产品路径通）；无手势的脚本化注入会被 Chromium 静默丢弃、外部协议不回流，复现时看似「通道被拦死」。致谢名单新增 [@EliteOtaku](https://github.com/EliteOtaku)（issue #9 的逐层排查与三轮真实壳复测）。

### 核实
- issue #9 真实壳三轮复测（DSH Desktop 0.2.0-rc.2 / Windows 11）：点通知 = 抬窗 + 切会话一步到位，同会话、跨会话、窗口在后台均稳定 ✅，1.5.2 的抬窗修复确认生效。
- 修正 1.5.2 发布当天「CDP 注入 iframe 导航 0 新进程 ⇒ 沙箱 renderer 拦截外部协议」的判断：从发行包 `lib/main.js` 逐处核对，壳对主窗口既没有 `will-frame-navigate` 拦截、页面无 CSP，非 media 权限（含 `openExternal`）一律放行；真实差异在**用户手势上下文**，与渲染进程的 OS 沙箱无关（OS 沙箱 ≠ iframe 的 `sandbox` 属性，GHSA-p2rr-rvmm-c5fp 只影响后者）。

## [1.5.2] — 2026-10-04

### 新增
- **设置页新增「运行环境」**（默认自动识别）：按页面协议（`dsh-app://` = 桌面端 DSH Desktop）识别 Web 端 / 桌面端，识别不准时可手动指定「桌面端」或「Web 端」。手动覆盖同时决定两件事：点通知的抬窗通道（桌面端 `dsh://` 深链 / Web 端 `window.focus()`）与快捷裁决按钮的可用性标注；覆盖与自动识别不一致时设置页明示检测结果，强选「桌面端」但页面并非 `dsh-app://` 时另提示可能弹「打开应用」确认框。

### 修复
- **桌面端「点击通知回到对应对话」真正把窗口带到前台**（issue #9）：DSH Desktop 的页面跑在 `dsh-app://app`（Electron），DOM `window.focus()` 碰不到原生窗口，此前点通知只在后台切好对话、窗口不上前台。现在点通知正文时页面发一条隐藏 iframe 导航到 `dsh://open` —— 子框架导航不经过壳的 `will-navigate` / window-open 拦截，URL 交给系统协议注册，应用单实例锁的 `second-instance` 处理走壳自己的 `focusPrimaryWindow()`（restore + show + focus）。窗口隐藏在托盘、被别的窗口压住、最小化都能抬回来；切对话行为不变，浏览器端不受影响。

### 变更
- **设置页在桌面端明示快捷裁决按钮不可用**：`dsh-app://` 页面无法注册 Service Worker（实测），审批通知的「同意 / 拒绝」按钮渲染不了、自动退回无按钮样式；此前开关本身毫无标注（只有测试按钮的反馈里带一行原始 `bridge` 状态），容易被当成开关坏了。现在设置页在桌面端直接说明这是宿主限制；「测试『审批按钮』」在无桥环境发普通测试通知时也明说按钮渲染不了。
- **测试按钮的反馈文字移到按钮正下方**：此前落在页面最底部（常在视口外），点了测试看不到任何反馈，像「没反应」；无桥 / 开关关闭时的提示也一并放在同一位置。
- `window.__dshNotifyMe.debug()` 新增 `desktop`（生效环境是否桌面端）、`raiseChannel`（`dsh-deeplink` / `window-focus`）、`hostEnv`（设置值）与 `hostEnvDetected`（自动识别结果）。
- 版本号 1.5.1 → 1.5.2；`window.__dshNotifyMe.version` 同步。
- README（中英）同步：设置清单加「运行环境」，新增「桌面端怎么抬窗的 / How the Desktop window gets raised」一节，「点击通知回到对应对话」「审批通知上直接裁决」两条口径与已知限制（桌面端按钮不可用由「未实测」改为实测结论）。

### 测试
- 抬窗通道实测：最小 Electron 44 复刻（`setWindowOpenHandler` / `will-navigate` 与桌面壳同款拦截、不装 `setPermissionRequestHandler`）上，非沙箱 iframe 导航 `dsh://open` 抬起真实 DSH Desktop 窗口（restore + 前台约 0.8s），沙箱 iframe 被拒（Electron GHSA-p2rr-rvmm-c5fp 修复生效），`window.focus()` 不抬（与 issue #9 结论一致）；`dsh://open` 经系统协议回流四轮实测均可靠抬窗。
- `smoke/smoke-test.cjs` 新增桌面抬窗通道用例段：桌面端点通知正文发 `dsh://open` 深链且仍切对话、浏览器端绝不发深链、`hostEnv` 手动覆盖双向生效（强 Web 桌面页不发链、强桌面 Web 页发链）。

## [1.5.1] — 2026-10-04

### 修复
- **「点击通知回到对应对话」在带按钮的审批通知上补齐窗口调度**：这类通知由 Service Worker 弹出，此前 worker 只把点击转告页面，窗口能不能到前台全押在页面消息回调里的 `window.focus()` 上——那段代码不在用户点击的手势上下文里，Windows 前台抢占规则下窗口可能根本抬不起来。现在 worker 在 `notificationclick` 里按规范用 `client.focus()` 调起窗口。
- **多标签页不再互相抢焦点、一起乱切对话**：worker 的点击转信此前广播给所有同源 DSH 标签页，每个开着的标签页都会聚焦自己并各自切对话。现在一次点击只挑一个窗口（优先当前可见的）调起并切对话，其余窗口只收「不导航」的副本、留在原地；「同意 / 拒绝」按钮照旧只裁决、不调窗口。
- 「点击通知回到对应对话」关掉后的承诺在持久通知上也成立：show 时把该设置记进通知 `data`，worker 据此不调任何窗口；旧版本弹出的遗留通知没有该字段，维持此前行为。

### 变更
- 版本号 1.5.0 → 1.5.1；`window.__dshNotifyMe.version` 同步。
- README（中英）同步：「点击通知回到对应对话」补多窗口口径，「工作原理」补 worker 侧的窗口调度说明。

### 测试
- `smoke/smoke-test.cjs` 快捷裁决桥用例补两个 window client 的点击路由断言：点正文只调起可见窗口并只让它切对话（其余客户端收 `navigate: false` 不动）、点正文不裁决；点按钮不调任何窗口也不切对话；`autoFocus` 关掉时通知 `data.focus` 记 `false`、点击既不调窗口也不切对话。

## [1.5.0] — 2026-10-03

### 新增
- **「完成未读」标题标记**：后台会话的回复跑完、你还没打开看的期间，标签页标题前出现 `✅ 回复完成 · …` / `✅ Reply finished · …`，打开该会话（宿主此时清掉未读）或它再次开跑即消失——离开屏幕再回来，一眼看到哪些跑完了。与「需要你」标记可同时出现（「需要你」在前），宿主改写标题后标记基于新标题重建。未读事实取自宿主：`≥ 0.1.6` 用 `sessionStatus` 行的 `completionUnread`（后台会话完成即点亮，打开 / 再次开跑 / 会话消失即清零），旧宿主用列表行的 `completed` 提醒位（选中会话即清零）。静音中的后台子代理会话照旧不标记；「页面打开时也提醒『回复完成』」开关只管通知，不影响标记。
- **「回复完成」通道接上宿主的完成未读标志**：此前只靠 `running` 快照边沿，页面没看见的完成（插件热重载中途、快照把 true→false 合并成一跳、完成发生在绑定之前）就永远漏掉。现在 `sessionStatus` 的 `completionUnread` 级别标志（0.1.6+）负责补漏——每条未读实例只报一次，绑定时已存在的未读也补报一声；边沿与级别标志是同一次完成的两个视角、同刻到达时按短时间窗合并成一声。边沿路径保持不变：当前会话的正文仍带回复摘要，旧宿主照旧。
- 「等你操作」不算完成：一轮带着 plan-review / 提问结束时只走「需要你」提醒，答完也不补「回复完成」马后炮；宿主仍标未读时，标题标记照常挂到你打开会话为止。后台子代理会话的未读照旧静音，解除静音后补报一次。
- `window.__dshNotifyMe.debug()` 新增 `doneUnreadMarked`（当前挂着「完成未读」标记的会话列表）。

### 变更
- 版本号 1.4.0 → 1.5.0；`window.__dshNotifyMe.version` 同步。
- README（中英）同步：「提醒时机」表、「提醒方式」的标题标记说明、「工作原理」的完成未读级别标志两代取源与合并口径。

### 测试
- `smoke/smoke-test.cjs` 新增 completionUnread 用例段：漏报补发、同刻双视角只响一声、绑定前已有的未读只报一次、等输入的停顿不算完成（答完不补马后炮、标记照旧）、当前会话不走未读通道、后台子代理静音与解除静音、页面可见时只留标记不弹通知、双标记叠加与宿主改标题后的重建；legacy 用例补 `completed` 提醒位的标记出现与「选中会话即撤」。
- `smoke/cordis-host-test.mjs` 在真 cordis `sessionStatus` 宿主上补一条走真 store 的完成未读用例：报告一次、标记、不重复、打开即撤。

## [1.4.0] — 2026-10-03

### 新增
- **子代理会话不提醒**（设置页新开关「子代理会话不提醒」，默认开启）：DSH 把每个子代理（subagent）子会话列成独立会话行（`origin: 'subagent'` 加 `parentId`），于是这些子会话的「需要你」与「回复完成」都会照常弹通知——可它们是所属主对话那一轮里的步骤，提醒只是噪音。现在默认静音**后台**子代理会话：列表行评估与 `sessionStatus` 等待通道都跳过「带 `origin: 'subagent'` 且不是当前会话」的行；你正打开着的那个子代理会话不算静音对象，照常提醒（走当前对话的常规规则：页面可见时默认只留标题标记、转后台补发）。主对话自己的提醒不受影响。
- 判定认 `origin` 加「不是当前会话」两条：只有 `parentId`、没有 `origin` 的分支（fork）会话仍是你自己的对话，照常提醒；静音随你打开的会话实时变化——切进某个后台子代理会话，它积压的等待按当前对话的规则补上，切走后重新回到静音范围（标题标记与排队中的通知一并撤下）。静音开关读的是实时配置，切换后下一条事件即生效，不需要重载页面。
- `window.__dshNotifyMe` 配置新增 `ignoreSubagent`（默认 `true`，可用 `setConfig` / `resetConfig` 调整），`debug()` 新增同名字段便于核对。

### 变更
- 版本号 1.3.1 → 1.4.0；`window.__dshNotifyMe.version` 同步。
- README（中英）补上设置页新开关、提醒时机说明、控制台配置示例与工作原理里的子代理口径。
- README（中英）新增「致谢与贡献须知 / Credits & how contributions land」：外部 PR 的署名口径与贡献者名单；「只静音后台子代理、当前打开的照常提醒」这一口径来自 [@d0ublecl1ck](https://github.com/d0ublecl1ck) 在 [#8](https://github.com/chromoany/dsh-notify-me/pull/8) 讨论里的建议（收编进 main 的原版是整条静音），本次按该口径改准并由维护者落地。

### 测试
- `smoke/smoke-test.cjs` 新增子代理用例：`ignoreSubagent` 默认值与 `debug()` 字段、后台子代理完成不提醒而普通后台会话照常、后台子代理等待不提醒也不打标题标记、分支（fork）会话仍提醒、关掉开关后子代理的等待与完成重新提醒，以及「当前打开的子代理会话照常提醒」——等待与完成都提醒；后台积压的等待在切进去时按当前对话的规则排队补发，切走则连标题标记与排队通知一起撤下。

## [1.3.1] — 2026-10-03

### 文档
- README 中英补齐 1.1.7 / 1.1.8 起就有、但一直没写进文档的两个设置项：「当前对话不弹通知」（`currentHiddenOnly`）与「点击通知回到对应对话」（`autoFocus`），控制台配置示例同步补 `currentHiddenOnly`；「提醒时机」表的默认口径改为「页面可见也提醒（当前对话除外：默认只留标题标记）」——原表述把当前对话的静默规则漏掉了。
- 措辞去掉 Windows 专属口径：系统通知按「经浏览器弹出，进 Windows 通知中心或 macOS 通知中心」描述，权限提示补 macOS 的 系统设置 → 通知；已知限制新增 macOS 一条——浏览器路径无平台假设，但 DSH Desktop（Electron）的系统通知要求应用已签名（官方 macOS 版是否满足未实测），审批按钮在 macOS 与桌面宿主上的渲染同样未实测，不渲染时自动退回无按钮通知。
- 已知限制补「当前对话不弹通知」按 `document.hidden` 判定的边界（窗口被别的应用完全盖住仍算可见）；开发自检一节补 `cordis-host-test.mjs` 的 cordis 探测路径（含 `~/.dsh/profiles/node_modules` 平铺回退目录）。

### 变更
- 版本号 1.3.0 → 1.3.1；`window.__dshNotifyMe.version` 同步。功能零改动。

## [1.3.0] — 2026-10-03

### 新增
- **审批通知上直接裁决**（设置页新开关「审批通知上直接裁决」，默认开启）：权限审批的系统通知带上「同意 / 拒绝」按钮，点一下就完成裁决，不用切回页面。按钮调的是审批卡片自己的 `PendingApproval.answer('allowed-once' | 'rejected')`——「同意」即「允许一次」，只放行这一次，与卡片上的按钮完全同义；点通知正文仍是 1.1.8 的「回到对应对话」。
- 绕开的是一条浏览器硬限制：`actions` 只属于 Service Worker 弹的持久通知，往 `new Notification()` 里传 `actions` 直接抛 `TypeError`。所以 bundle 一份文件两用：页面里照常注册提醒工厂，同一份字节再注册成 Service Worker，只负责把「点了哪个按钮」（同意 / 拒绝 / 点正文）转告页面（BroadcastChannel 与客户端 postMessage 双通道），裁决本身仍发生在页面里。注册只用本插件自己的单条目 combo URL（`/plugins/??dsh-notify-me/client.js&rev=…`，取自 `__DSH_BOOT__.entries`）——多插件 combo 会在 worker 里执行别家的 factory，注册必挂。
- 按钮通知按交互 key 记账：一条等待一次只认领一张通知；页面里先答掉、或被新请求顶替之后，残留通知上的按钮再点不裁决任何东西，只把通知关掉。请求消失时残留通知一并关闭；带按钮的通知不设 15 秒自动消失，未裁决的审批留在通知中心等你。
- `window.__dshNotifyMe` 新增 `decide(key, outcome)`（按钮的程序化同款，`outcome` 取 `"allowed-once"` / `"rejected"`）与 `test("approval")`（设置页新增「测试『审批按钮』」按钮，一条通知端到端验证按钮链路）；`debug()` 新增 `quickActions` / `bridge`（`active` = 按钮可用，否则给出不可用原因）/ `actionKeys`；`onEvent` 新增 `decision` 事件（`{key, outcome, sessionId}`，测试点击另带 `test: true`）。

### 变更
- 带按钮的审批通知改用 `dsh-notify-me-attention-<key>` 独立标签，多条待审批互不顶掉；提问 / 方案确认沿用原来的 `dsh-notify-me-attention` 标签行为。
- 不支持 Service Worker 的环境（`http://` 局域网地址等）自动退回 1.2.x 的无按钮通知，其余功能不受影响，`debug().bridge` 显示具体原因。
- 版本号 1.2.1 → 1.3.0；`window.__dshNotifyMe.version` 同步。

### 测试
- `smoke/smoke-test.cjs` 新增快捷裁决桥用例，把 bundle 的两半都在同一套件里跑起来（worker 半侧执行在 worker 形状的 vm 上下文，页面半侧走常规桩，两边用同一个 BroadcastChannel 桩对接）：单条目 combo URL 注册、按钮文案与 `data` 携带 key/会话、点「同意」→ `answer('allowed-once')`、点「拒绝」→ `answer('rejected')`、陈旧 key 与未知 key 一律不裁决、页面里先答掉后残留按钮失效、`quickActions` 关闭或无 Service Worker 时退回普通通知且不带 `actions`（构造函数带它会抛 `TypeError`）、测试按钮走完整 worker 链路。
- `smoke/cordis-host-test.mjs` 在 `sessionStatus` 宿主上补真 cordis 语义的裁决用例：`decide()` 经 `ctx.get("uiSession")` 找到活着的交互并调它的 `answer()`，重复裁决与未知 key 拒绝，标记随之释放。

### 已知限制
- 按钮要 Service Worker：`http://127.0.0.1`、`https` 可用，`http://192.168.x.x` 这类局域网地址不行；DSH Desktop（Electron）里按钮能否渲染未实测，不渲染时按上述降级走无按钮通知。

## [1.2.1] — 2026-10-03

### 修复
- **提示音叠着响两声**：`new Notification(...)` 没带 `silent: true`，平台自带通知音与插件自己的 WebAudio 提示音各响一遍。现在通知一律静音，声音统一由插件承担（attention / done 两种音型、音量设置不变）；设置页「提示音」关掉即完全安静。

### 变更
- `smoke/cordis-host-test.mjs` 借用 cordis 的探测路径补上 `~/.dsh/profiles/node_modules`（`healProfilesModuleFallback` 维护的平铺回退目录）：此前只探测 `profiles/web/node_modules`，多数机器上最强的那套真 cordis 端到端用例会静默跳过。

## [1.2.0] — 2026-09-30

### 修复
- **`0.1.6-alpha.2` 及以后（含 `0.2.0-rc.2`）宿主上「模型需要你操作」整条通道再次静默失效**：上游把待办交互从 `uiSession.pendingInteractions`（`Map<sessionId, interaction>`）搬进了 `uiSession.sessionStatus`（`Map<sessionId, {running, pendingInteraction, completionUnread}>`），旧 store 在新宿主上根本不存在——插件读不到就静默不提醒（审批卡片出现、模型停下，系统通知/提示音/标题标记全无；而「回复完成」与设置页测试按钮照常，现象与 1.1.5 那次一模一样）。现按宿主代际自动选源：`≥ 0.1.6-alpha.2` 绑定 `sessionStatus`，`0.1.2 .. 0.1.5` 仍用 `pendingInteractions`，`≤ 0.1.1` 仍走控制器快照；`window.__dshNotifyMe.debug()` 新增 `uiSessionSource`，直接显示这条通道绑的是哪个来源。
- **`0.1.6` 及以后的宿主上认不出「当前会话」**：会话列表快照不再有 `current`（`SessionListState` 只剩 `ids / byId / phase / projectionsBySession`），于是当前会话面（face）订阅从未建立、`onListChanged()` 还把当前会话当成后台会话评估——后果是 1.1.7 的「当前对话不弹通知」规则失效（审批卡片就在屏幕上，Toast 仍会盖上去），标签页标记的归属也随之错位。现在按宿主自己的口径推导：有 `current` 用它，没有就取 `retainedBy.mainView > 0` 的那一行（与内置 `DocumentTitle` / `ui-workspace` / `ui-session` 的判定一致）。
- **`0.1.6` 及以后点通知切不回对应会话**：`sessions.open(id)` 已被移除，导航改由 `uiWorkspace.openSession(id)` 承担；插件现在两个都试（`open` 优先，旧宿主行为不变），会话已不在列表时依旧不调用。`debug()` 新增 `currentSession` 便于核对。

### 变更
- 提醒语义在适配后原样保持（1.1.x 既有逻辑，不是新行为）：同一会话里等待被替换成新 key 时旧的标题标记随之释放，等待消失（`pendingInteraction` 变 `null`）时按 key 释放标记，重复通知不重复提醒。
- `peerDependencies` 放宽为 `^0.1.0-rc.6 || ^0.1.1-rc.2 || ^0.1.2-rc.1 || ^0.1.5-rc.1 || >=0.1.6-alpha.2 <0.2.0-0 || >=0.2.0-rc.1 <0.3.0-0`：原范围在 `0.2.0-rc.2` 上被 `evaluatePluginCompatibility` 判为不兼容，`dsh plugin add` 会拒绝并回滚安装（`0.3` 线仍被拒）。`dsh.compatibility.dshReleases` 增加 `0.2.0-rc.2: compatible`。范围对未实测的 `0.2.x` 正式版同样放行，是否兼容以 `dshReleases` 的实测声明为准。
- 版本号 1.1.8 → 1.2.0（新宿主代际）；`window.__dshNotifyMe.version` 同步。
- 设置页字典注册改为把 `locale.register()` 返回的 disposer 交给 `ctx.effect`（与官方 `ui-approval` 写法一致），客户端插件 HMR 重载时不会因「同名 namespace 已注册」而丢掉设置页。
- `uiSession` 绑定的诊断降噪：真实 `0.2.0-rc.2` 页面上每次加载都会出现的那条 `uiSession is provided but not reachable` 警告其实是**启动竞态**（本插件的客户端条目常早于 `ui-session` 条目激活，此时 `ctx.get()` 按 cordis 的严格语义拿不到尚未激活的服务），并非缺陷。现在只有**能拿到服务实例、但它既没有 `sessionStatus` 也没有 `pendingInteractions`** 时才打一条警告（并提示附上 `debug()` 输出）；「还没可见」保持安静，由 1.5s 重试定时器接管，`debug().uiSessionNote` 仍可查。

### 测试
- `smoke/smoke-test.cjs` 增加第三代宿主用例（`uiSession.sessionStatus`、列表无 `current`、无 `sessions.open`）：审批/提问/方案确认文案与详情、去重、等待消失释放标记、挂载前已存在的等待提醒一次、当前对话静默 + 转后台补发、后台会话前台提醒、主开关、`retainedBy.mainView` 推导当前会话、点通知走 `uiWorkspace.openSession`、会话已消失不打开。
- `smoke/cordis-host-test.mjs` 增加真 cordis 的 `sessionStatus` 宿主（兄弟插件提供 `sessionStatus` 与 `uiWorkspace`，`sessions` 不带 `open`）：断言订阅绑到 `sessionStatus`、审批只提醒一次且正文带工具名 + 理由、标题标记设置与释放、点通知调用 `uiWorkspace.openSession`。原有 `pendingInteractions` 宿主与无 `uiSession` 的旧宿主用例保留。
- 自检命令补 `DSH_CORDIS_PATH`：源码 checkout 里没有 profile 依赖时，用它把 `cordis-host-test.mjs` 指向 checkout 内的 `vendor/cordis/lib/index.js`（否则该用例按设计跳过）。

### 已知限制
- `≥ 0.1.6`（含 `0.2.0-rc.2`）的「回复完成」提醒正文不再附带回复摘要：宿主快照不再提供 `nodes`，摘要取不到；提醒本身照常触发。

## [1.1.8] — 2026-09-24

### 新增
- **点通知直接回到那条对话**：系统通知现在带着它所属的会话 id，点一下就用 `sessions.open(id)` 把那个会话切成当前会话——以前只把 DSH 窗口带到前台，还得自己找是哪条在等。若该会话已经不在列表里则不调用（`open()` 对未知 id 会直接抛错），点击仍会把窗口带到前台。
- `onEvent` 回调的 payload 增加 `sessionId`。

### 变更
- 设置项「点击通知把 DSH 切回前台」改为「点击通知回到对应对话」并补上说明；关掉后点击通知依然不做任何事。
- 顺手加固 `canToast()`：某些策略下 `Notification` 存在但读 `permission` 会抛错，原来会把整条投递链（连 `onEvent` 一起）打断，现在只在确认不了权限时按「不能弹」处理。
- 测试：两个套件各补「点击通知 → 宿主收到 `open(该会话)`」与「会话已消失 → 不调用 `open`」的用例。

## [1.1.7] — 2026-09-24

### 新增
- **当前对话的「需要你」提醒不再弹通知**（设置页新开关，默认开启）：当等待就发生在你正看着的那个对话里、且页面在前台时，只保留标签页标记，不弹系统通知、不响提示音——审批卡片本来就在屏幕上，Toast 只会盖住它。页面一转到后台，被压下的那条提醒立刻补发；若在补发之前你已经处理掉了，它随之作废。
- `window.__dshNotifyMe.debug()` 增加 `currentHiddenOnly` 与 `quietedKeys`（当前被压下、等着补发的提醒 key）。

### 变更
- 页面可见时**其它会话**（后台会话）的等待照常提醒，不受这条规则影响；把开关关掉即恢复 1.1.6 的行为。
- 测试：`smoke/smoke-test.cjs` 与 `smoke/cordis-host-test.mjs` 各补用例——「当前会话 + 前台 → 静默并排队」「转后台 → 补发一次」「当前会话 + 前台 + 已处理 → 不补发」「后台会话 + 前台 → 照常提醒」，并在两代宿主（`uiSession` 路径与 controller 路径）上都覆盖。

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
