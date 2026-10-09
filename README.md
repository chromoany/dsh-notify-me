# dsh-notify-me

简体中文 | [English](README.en.md)

[![npm version](https://img.shields.io/npm/v/dsh-notify-me?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/dsh-notify-me)
[![npm downloads](https://img.shields.io/npm/dm/dsh-notify-me?style=flat-square&label=downloads&color=1F883D)](https://www.npmjs.com/package/dsh-notify-me)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-browser-blue)
![Size](https://img.shields.io/badge/bundle-%7E79KB-green)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

---

**离开 DSH 页面也不错过任何动静。** 当模型停下来需要你操作（审批 / 方案待确认 / 提问）、或你在别的软件时回复正好在后台完成，dsh-notify-me 会用系统通知 + 提示音 + 标签页标题标记提醒你——权限审批的通知还带「同意 / 拒绝」按钮，点一下就完成裁决，不用切回页面。开关和通知语言都直接在 **DSH 设置 → 通知提醒** 里改。

---

## 为什么需要它

DSH 的两种权限模式各有代价：

| 模式 | 你付出的代价 | 代价形态 |
| --- | --- | --- |
| 不开完整访问（`workspace-write` + ask） | **等待**——agent 卡在审批上，不盯着页面就是干等 | 时间成本，随会话数增长 |
| 开完整访问（full access） | **不可逆风险**——放弃的是事前拦截能力 | 风险成本，与你盯不盯无关 |

dsh-notify-me 把「监督」和「守在屏幕前」解耦：只在真的出现决策点（审批 / 方案确认 / 提问）或回复跑完时，才用系统通知把你叫回来——**让你敢不开完整访问**，不必靠放弃拦截能力来换效率。它不降低 full access 本身的权限风险（它不是沙箱），只是把 ask 模式的等待成本压到接近零。

---

> 🔎 想找这个插件？可以搜：`dsh-notify-me`、**消息提醒**、**可操作提醒**、**桌面通知**、**需要你操作**、**回复完成提醒**、**后台完成提醒**（npm 关键词已含以上中英文词）。

## 效果预览

| 系统通知效果（截图来自 Windows） |
| --- |
| ![DSH 通知效果](https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/screenshots/notify-toast.png) |

[更新日志](CHANGELOG.md)

## 提醒时机

| 时机 | 提醒内容 | 默认 |
| --- | --- | --- |
| 🔔 **模型需要你操作** — 审批请求 / 方案待确认（plan review）/ 提问（`ask_user_question`） | 通知 + 提示音 + `🔔 需要你 ·` 标题标记；审批的通知上直接带「同意 / 拒绝」按钮 | 页面可见也提醒（当前对话除外：默认只留标题标记） |
| ✅ **回复完成** — 一轮回复跑完；后台会话完成也会报 | 通知 + 提示音；后台会话**完成但还没看**的期间标题带 `✅ 回复完成 ·` 标记，打开该会话即撤 | 仅页面隐藏/后台时提醒（标题标记不受此限） |

> **后台**子代理（subagent）子会话的等待与完成默认**不提醒**：DSH 把每个子代理子会话列成独立会话，但它们是所属主对话那一轮里的步骤，提醒只会是噪音。你当前打开的那个子代理会话不算在内，照常提醒。设置页「子代理会话不提醒」可关掉这个静音。

## 在 DSH 设置里改配置

打开 **设置 → 通知提醒**（首次安装后刷新一次页面即可看到），页面提供：

- **启用提醒** 主开关：关闭后不再弹系统通知、不播放提示音、也不改标签页标题；
- **运行环境**（默认自动识别）：按页面协议识别 Web 端 / 桌面端（DSH Desktop，`dsh-app://`），识别不准时可手动指定——桌面端点通知走 `dsh://` 深链抬窗、快捷裁决按钮不可用；Web 端走 `window.focus()` 与 Service Worker 桥。手动覆盖与自动识别不一致时，设置页会明示检测结果；
- **系统通知 / 提示音 / 音量**：Toast、提示音开关与音量滑块；
- **音效来源**（「需要你」与「回复完成」各自独立选）：内置合成音（默认）/ 自定义音频文件 / 系统通知音。选「自定义音频文件」可在设置页挑一个本地音频（上限 1 MiB，存在浏览器本地，可试听与移除）；选「系统通知音」则完全不播插件音效，通知照发，声音交给操作系统（音色跟着系统通知设置走），此时「试听」会改发一条测试通知——该模式没有插件可播的音，你听到的就是它。任一来源缺文件、读不出来或存不下时自动回落到内置合成音，提醒不会因此变成哑的；
- **页面打开时也提醒「需要你」**（默认开）与 **页面打开时也提醒「回复完成」**（默认关）；
- **当前对话不弹通知**（默认开）：等待就发生在你正看着的对话里时只留标题标记，不弹通知也不响音（免得盖住审批卡片）；页面切到后台立刻补发，若你已经处理掉就作废。其它后台会话不受影响；
- **子代理会话不提醒**（默认开）：后台子代理（subagent）子会话的「需要你」与「回复完成」都不提醒——它们是主对话那一轮的步骤，完成由主对话自己的提醒覆盖；你当前打开的那个子代理会话照常提醒；关掉后恢复逐会话提醒；
- **点击通知回到对应对话**（默认开）：点通知把 DSH 带到前台并切到提醒所属的对话；多个 DSH 标签页同时开着时，一次点击只调起一个窗口（优先当前可见的那个）并只切它的对话，其余标签页不动；关掉后点通知不做任何事。桌面端（DSH Desktop）同样会把窗口带到前台并切对话：页面侧的 `window.focus()` 在 Electron 里抬不动原生窗口，1.5.2 起改走应用自己的 `dsh://open` 深链调窗（窗口隐藏在托盘里也能被抬回来）；
- **审批通知上直接裁决**（默认开）：权限审批的通知上带「同意 / 拒绝」按钮，点一下就按审批卡片的「允许一次 / 拒绝」直接裁决，不用切回页面；点通知正文仍是原来的「切回对应对话」。**桌面端暂不支持按钮**（`dsh-app://` 页面无法注册 Service Worker），审批通知自动退回无按钮样式，设置页会明示这一限制；
- **通知语言**：跟随界面 / 简体中文 / English——决定通知文字与 `🔔 …` 标题标记使用的语言；
- **测试按钮**：用当前设置立即发一条「需要你」「回复完成」或「审批按钮」测试提醒（**不受**上面「页面打开时也提醒」开关限制；「需要你」测试的标题标记约 6 秒后自动消失）；
- **版本信息**：设置页底部常显当前插件版本号（`dsh-notify-me v…`）——报障、核对是否装上新版本时直接照抄这一行。

> 需要浏览器通知权限：页面上点一下 → 允许；或地址栏锁 → 站点设置 → 通知 → 允许 → 刷新。macOS 还要在 系统设置 → 通知 里允许该浏览器。

## 提醒方式

- **系统通知**：经浏览器弹出的系统通知，进 Windows 通知中心或 macOS 通知中心（点击回到提醒所属的对话；审批的通知点按钮直接裁决）
- **提示音**：默认是 WebAudio 合成音（「需要你」与「完成」使用不同音型）；可在设置里为两类提醒分别换成自定义音频文件，或改成让操作系统播放它自己的通知音
- **标签页标题标记**：有待处理事项时，标题前出现 `🔔 需要你 · …` / `🔔 Action needed · …`；后台会话**完成但还没看**时出现 `✅ 回复完成 · …` / `✅ Reply finished · …`，打开对应会话（或它再次开跑）即消失。两种标记可同时出现，「需要你」在前；宿主改写标题后标记基于新标题重建

本插件是**浏览器层**实现：DSH 页面需保持打开（最小化/后台即可——那正是它监听的「离开」状态）。

## 安装

```powershell
# DSH 官方插件命令：安装并自动挂载进 web profile
dsh plugin --profile web add dsh-notify-me
```

重启 `dsh web` 后硬刷新页面（Ctrl+Shift+R）。

**兼容性** — 插件按宿主代际自动选源，逐版本声明见 `package.json` 的 `dsh.compatibility.dshReleases`：

| 宿主代际 | 「需要你」交互来源 | 判断当前会话 | 点通知切会话 |
| --- | --- | --- | --- |
| `≤ 0.1.2-alpha.1` | 控制器快照的 `pending[]` | 快照 `current` | `sessions.open()` |
| `0.1.2-alpha.2 .. 0.1.6-alpha.1` | `uiSession.pendingInteractions` | 快照 `current` | `sessions.open()` |
| `≥ 0.1.6-alpha.2`（含 `0.2.0-rc.2`） | `uiSession.sessionStatus` | `retainedBy.mainView` | `uiWorkspace.openSession()` |

区间仅作示意：插件按 store 形状自动选源（`sessionStatus` 存在即走新路），版本号只是各形状的出现边界。`package.json` 的 `peerDependencies` 范围同理只影响 npm install 的提示文案——兼容与否以 `dshReleases` 的逐版实测声明为准，未实测的新版本由形状驱动兜底。

实测**真正激活**（各自独立 profile 启动：设置里出现「通知提醒」分区，即插件的 `apply` 确实执行）于 `0.1.2-rc.1`、`0.1.5-rc.2` 与 `0.2.0-rc.2`；更早的 `0.1.1-rc.2` 亦验证过。两个坑值得记住：一是 `dsh.client.inject` 里列了新版运行时已不再提供的包，客户端条目会停在 `pending (waiting for services: …)` 而永不执行——1.1.3 在 `0.1.2-rc.1` 及以后正是这样失效的；二是宿主换存储/字段名时**不会报错**，提醒只会静默失效——`0.2.0-rc.2` 上 `pendingInteractions`→`sessionStatus`、`list.current`→`retainedBy.mainView`、`sessions.open()`→`uiWorkspace.openSession()` 都是这一类，所以每次适配都要用 `window.__dshNotifyMe.debug()` 确认真的是 `bound`、以及用的是哪个来源。

**验证** — F12 控制台执行：

```js
window.__dshNotifyMe.test("done")        // 「完成」示例
window.__dshNotifyMe.test("attention")   // 「需要你」示例
window.__dshNotifyMe.test("approval")    // 「审批按钮」示例：通知上有「同意 / 拒绝」，点着试试
window.__dshNotifyMe.debug()             // 桥接状态看 bridge 字段，active = 按钮可用
```

没反应？九成是：通知权限被拒绝（在页面上点一下 → 选「允许」；或地址栏锁 → 站点设置 → 通知 → 允许 → 刷新）、装完没重启 DSH、系统设置里浏览器通知被关。

## 控制台高级配置

设置页是第一入口；想脚本化/批量改或恢复默认时，偏好存 `localStorage`（`dshNotifyMe.config`），可用控制台实时调整：

```js
window.__dshNotifyMe.config                       // 查看
window.__dshNotifyMe.setConfig({
  enabled: true,           // false = 关闭所有提醒（主开关）
  language: "auto",        // 'auto' 跟随界面 | 'zh' 简体中文 | 'en' English
  attentionHiddenOnly: false, // true = 页面可见时「需要你」不提醒
  currentHiddenOnly: true,    // true = 当前对话的等待只留标题标记（转后台补发）
  doneHiddenOnly: true,       // false = 页面可见时「完成」也提醒
  ignoreSubagent: true,       // true = 后台子代理（subagent）会话不提醒（当前打开的照常）
  toast: true,                // 系统通知开关
  sound: true,                // 提示音开关（含「系统通知音」模式）
  soundDone: "synth",         // 「完成」音效来源：'synth' 内置 | 'custom' 自定义文件 | 'system' 系统通知音
  soundAttention: "synth",    // 「需要你」音效来源，取值同上
  volume: 0.5,                // 音量 0~1
  autoFocus: true,            // 点通知回到提醒所属的对话
  quickActions: true          // 审批通知上的「同意 / 拒绝」按钮
})
window.__dshNotifyMe.resetConfig()                // 恢复默认（同时清掉已选的自定义音效文件）
window.__dshNotifyMe.decide("approval:3", "allowed-once")  // 程序化裁决："allowed-once" | "rejected"
```

> 自定义音效文件不在 `dshNotifyMe.config` 里，而是按类别各存一个键（`dshNotifyMe.sound.done` / `dshNotifyMe.sound.attention`，内容是 `{name, size, data}` 的 data URL）——一个文件转成 data URL 会膨胀约 1.37 倍，塞进配置会拖慢每次读取。`resetConfig()` 会连这两个键一起清掉。
>
> 想确认当前生效的来源，看 `window.__dshNotifyMe.debug()` 的 `soundDone` / `soundAttention` 与 `customSoundDone` / `customSoundAttention`。

## 工作原理

提醒核心按宿主代际取源（见上表），当前会话一律来自客户端 `sessions` 服务：

- **当前会话** `SessionSnapshot`：`running` true→false = 回复完成；
- **待办交互**：`uiSession` 的 `sessionStatus`（`≥ 0.1.6`，逐会话 `pendingInteraction`）或 `pendingInteractions`（`0.1.2 .. 0.1.5`）出现新 key = 模型在等你，容器里带上审批工具名 / 理由、提问文本；旧宿主回落到控制器快照的 `pending[]`；
- **其它已列会话**摘要：`running` true→false（或旧宿主的 `completed` 边沿）= 后台工作提醒。宿主的「完成未读」级别标志负责补漏与标题标记：`≥ 0.1.6` 用 `sessionStatus` 行的 `completionUnread`（后台会话完成即点亮、打开该会话/再次开跑/会话消失即清零），旧宿主用列表行的 `completed` 提醒位（选中会话即清零）；页面没看见的完成边沿（插件热重载中途、快照合并跳变）由此补报一次，边沿与级别标志同来时按短时间窗合并，只响一声。
- **子代理会话**：列表行带 `origin: 'subagent'`（并有 `parentId`）的**后台**会话默认静音；你正打开着的那个子代理会话不算静音对象，它的提醒走当前对话的常规规则（页面可见时默认只留标题标记、转后台补发），切进来时积压的等待同样补上，切走后重新静音。只有 `parentId`、没有 `origin` 的分支（fork）会话属于你自己的对话，始终照常提醒。

提醒核心仍然零第三方运行时依赖、完全自包含：通知文字按所选语言（跟随界面 / 中文 / English）即时解析。设置页是**可选**的 React 呈现层——当 DSH web profile 提供 `slots` / `locale` / `react` 时才注册进「设置 → 通知提醒」，缺任一能力时插件自动降级为纯提醒（无设置页），不影响功能。

### 快捷裁决怎么走通的

通知按钮（`actions`）只属于 Service Worker 弹的持久通知，往 `new Notification()` 里传 `actions` 会直接抛 `TypeError`——这是绕不开的浏览器限制。所以 bundle 一份文件干两件事：页面里照常注册提醒工厂，同一份字节再注册成一个只干转信的 Service Worker，把「点了哪个按钮」（同意 / 拒绝 / 点正文）带回页面。真正的裁决发生在页面里，调的是审批卡片自己用的 `PendingApproval.answer('allowed-once' | 'rejected')`，所以「同意」就是「允许一次」，不多放行任何东西。点正文的「调窗口 + 切对话」同样归 worker 这半侧调度：它用 `client.focus()` 只调起一个窗口（优先当前可见的），并只让那个窗口切对话——多个 DSH 标签页不会互相抢焦点或一起乱切。

每条按钮通知按交互 key 记账，一次只认领一条等待；请求被页面里答掉、或被新请求顶替之后，残留通知上的按钮再点也不会误裁，只是安静地关掉。带按钮的通知不设自动消失——审批没裁决就一直留在通知中心里等你。

### 桌面端怎么抬窗的

DSH Desktop 是一层 Electron 壳，页面跑在 `dsh-app://app` 下：DOM 的 `window.focus()` 只动浏览器窗口对象、碰不到原生窗口，壳的 `will-navigate` / `window-open` 又把页面里发 `dsh://` 的常规出口全堵上了——所以 1.5.1 及以前点通知只在后台切好对话，窗口不上前台。1.5.2 起点通知正文时页面发一条隐藏 iframe 导航到 `dsh://open`：子框架导航不经过壳的 `will-navigate` 拦截，URL 交给系统协议注册，应用的单实例锁收到第二次启动后走 `focusPrimaryWindow()`（restore + show + focus）——与登录完成页把客户端置前是同一条路。窗口隐藏在托盘、被别的窗口压住、最小化，都能被抬回来。浏览器端不受影响，仍走 `window.focus()` / worker `client.focus()`。

真实壳已实测（DSH Desktop 0.2.0-rc.2，issue #9 三轮复测）：点通知 = 抬窗 + 切会话一步到位，跨会话、窗口在后台时同样稳定。触发时机是这条链路的关键：深链必须在**带用户手势的处理器**里发——通知的 `onclick` 自带手势，所以产品路径通；而无手势的脚本化注入（如 CDP evaluate 手工塞 iframe）会被 Chromium 静默丢弃、外部协议根本不回流，复现时看起来就像「通道被拦死」。

## 已知限制

- 页面必须开着才会提醒（后台标签/最小化可以；关标签页即失效——浏览器层方案固有限制）。
- 通知经由浏览器弹出，需允许浏览器通知权限，且勿扰模式不能屏蔽它。
- 每次页面加载后第一次出声/弹通知前，需在页面上点击过一次（浏览器自动播放与权限策略）。
- 未授权通知权限时只有提示音与标题标记。
- 快捷裁决按钮要 Service Worker：`http://127.0.0.1`、`https` 可用，`http://192.168.x.x` 这类局域网地址不行；**桌面端（`dsh-app://`）已实测无法注册 Service Worker**，按钮渲染不了，审批通知退回无按钮样式。浏览器或桌面宿主不渲染通知按钮时，`window.__dshNotifyMe.debug()` 的 `bridge` 字段会说明原因，其余功能不受影响。
- macOS：浏览器里提醒、提示音、标题标记、点通知跳转都没有平台假设，照常工作；但 DSH Desktop（Electron）的系统通知要求应用已签名，未签名的通知直接发不出去，官方 macOS 版是否满足这一前提未实测；审批按钮在 macOS 桌面宿主上的渲染同样未实测（Windows 桌面端已实测不渲染，见上条），不渲染时自动退回无按钮通知。
- 配置存在浏览器 `localStorage`：换浏览器/设备或清除站点数据后会回到默认值（设置页可一键恢复默认）。
- `≥ 0.1.6`（含 `0.2.0-rc.2`）的「回复完成」提醒正文只有会话名，不再附带回复摘要——宿主快照已不再提供 `nodes`；提醒本身照常触发。
- 标题标记由宿主与插件共同写 `document.title`：宿主重算标题时标记可能被覆盖，直到下一次提醒事件重新写成。
- 「当前对话不弹通知」按 `document.hidden` 判定：窗口被别的应用完全盖住时仍算「页面可见」，此时当前对话的等待照样静默。

## 开发自检

```powershell
node --check lib\client.js
node --check lib\index.js
node smoke\smoke-test.cjs        # 离线状态机冒烟测试：三代宿主 + 主开关 + 中英语言用例 + 快捷裁决桥（Service Worker 半侧一并跑）
node smoke\cordis-host-test.mjs  # 真 cordis 端到端（找不到本机 DSH 时自动跳过）
npm pack --dry-run               # 预览发布包
```

`cordis-host-test.mjs` 会从本机 DSH 安装借 `@deepseek-ai/cordis`（依次探测 npm 全局目录、`~/.dsh/profiles/web/node_modules` 与 `~/.dsh/profiles/node_modules` 平铺回退目录）；源码 checkout 里没有 profile 依赖时，用 `DSH_CORDIS_PATH=<checkout>/vendor/cordis/lib/index.js` 指定即可。

## 致谢与贡献须知

贡献者（按 handle 列出，链接指向他们参与的 PR / issue）：

- [@AgMahone](https://github.com/AgMahone) — [#7](https://github.com/chromoany/dsh-notify-me/pull/7)：0.1.6+ / 0.2.0 宿主代际支持，以及通知双响、cordis 查找路径的报障与复测；
- [@d0ublecl1ck](https://github.com/d0ublecl1ck) — [#8](https://github.com/chromoany/dsh-notify-me/pull/8)：子代理会话静音（`ignoreSubagent`）与配套测试、文档；1.4.0 里「只静音后台子代理、当前打开的照常提醒」的口径同样出自他在 #8 讨论里的建议，落地由维护者完成；
- [@EliteOtaku](https://github.com/EliteOtaku) — [#9](https://github.com/chromoany/dsh-notify-me/issues/9)：桌面端抬窗链路（1.5.2）的逐层排查与真实壳三轮复测——确认点通知抬窗 + 切会话稳定生效，并定位出「无用户手势的脚本化注入被 Chromium 静默丢弃」这一复现差异，纠正了最初「沙箱拦死」的判断。

署名口径：本仓库收编外部 PR 时以维护者提交落地——不沿用原 commit、不挂 Co-authored-by，GitHub 的 contributors 图只显示维护者，贡献者以上面的致谢署名。

## License

MIT — 见 [LICENSE](LICENSE)。
