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
| ✅ **回复完成** — 一轮回复跑完；后台会话完成也会报 | 通知 + 提示音 | 仅页面隐藏/后台时提醒 |

> 子代理（subagent）子会话的等待与完成默认**不提醒**：DSH 把每个子代理子会话列成独立会话，但它们是所属主对话那一轮里的步骤，提醒只会是噪音。设置页「子代理会话不提醒」可关掉这个静音。

## 在 DSH 设置里改配置

打开 **设置 → 通知提醒**（首次安装后刷新一次页面即可看到），页面提供：

- **启用提醒** 主开关：关闭后不再弹系统通知、不播放提示音、也不改标签页标题；
- **系统通知 / 提示音 / 音量**：Toast、WebAudio 提示音与音量滑块；
- **页面打开时也提醒「需要你」**（默认开）与 **页面打开时也提醒「回复完成」**（默认关）；
- **当前对话不弹通知**（默认开）：等待就发生在你正看着的对话里时只留标题标记，不弹通知也不响音（免得盖住审批卡片）；页面切到后台立刻补发，若你已经处理掉就作废。其它后台会话不受影响；
- **子代理会话不提醒**（默认开）：子代理（subagent）子会话的「需要你」与「回复完成」都不提醒——它们是主对话那一轮的步骤，完成由主对话自己的提醒覆盖；关掉后恢复逐会话提醒；
- **点击通知回到对应对话**（默认开）：点通知把 DSH 带到前台并切到提醒所属的对话；关掉后点通知不做任何事；
- **审批通知上直接裁决**（默认开）：权限审批的通知上带「同意 / 拒绝」按钮，点一下就按审批卡片的「允许一次 / 拒绝」直接裁决，不用切回页面；点通知正文仍是原来的「切回对应对话」；
- **通知语言**：跟随界面 / 简体中文 / English——决定通知文字与 `🔔 …` 标题标记使用的语言；
- **测试按钮**：用当前设置立即发一条「需要你」「回复完成」或「审批按钮」测试提醒（**不受**上面「页面打开时也提醒」开关限制；「需要你」测试的标题标记约 6 秒后自动消失）。

> 需要浏览器通知权限：页面上点一下 → 允许；或地址栏锁 → 站点设置 → 通知 → 允许 → 刷新。macOS 还要在 系统设置 → 通知 里允许该浏览器。

## 提醒方式

- **系统通知**：经浏览器弹出的系统通知，进 Windows 通知中心或 macOS 通知中心（点击回到提醒所属的对话；审批的通知点按钮直接裁决）
- **提示音**：WebAudio 合成音（「需要你」与「完成」使用不同音型）
- **标签页标题标记**：有待处理事项时，标题前出现 `🔔 需要你 · …` / `🔔 Action needed · …`

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

区间仅作示意：插件按 store 形状自动选源（`sessionStatus` 存在即走新路），版本号只是各形状的出现边界。

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
  ignoreSubagent: true,       // true = 子代理（subagent）会话不提醒
  toast: true,                // 系统通知开关
  sound: true,                // 提示音开关
  volume: 0.5,                // 音量 0~1
  autoFocus: true,            // 点通知回到提醒所属的对话
  quickActions: true          // 审批通知上的「同意 / 拒绝」按钮
})
window.__dshNotifyMe.resetConfig()                // 恢复默认
window.__dshNotifyMe.decide("approval:3", "allowed-once")  // 程序化裁决："allowed-once" | "rejected"
```

## 工作原理

提醒核心按宿主代际取源（见上表），当前会话一律来自客户端 `sessions` 服务：

- **当前会话** `SessionSnapshot`：`running` true→false = 回复完成；
- **待办交互**：`uiSession` 的 `sessionStatus`（`≥ 0.1.6`，逐会话 `pendingInteraction`）或 `pendingInteractions`（`0.1.2 .. 0.1.5`）出现新 key = 模型在等你，容器里带上审批工具名 / 理由、提问文本；旧宿主回落到控制器快照的 `pending[]`；
- **其它已列会话**摘要：`running` true→false（或旧宿主的 `completed` 边沿）= 后台工作提醒。
- **子代理会话**：列表行带 `origin: 'subagent'`（并有 `parentId`）的会话整条静音（默认）；只有 `parentId`、没有 `origin` 的分支（fork）会话属于你自己的对话，照常提醒。

提醒核心仍然零第三方运行时依赖、完全自包含：通知文字按所选语言（跟随界面 / 中文 / English）即时解析。设置页是**可选**的 React 呈现层——当 DSH web profile 提供 `slots` / `locale` / `react` 时才注册进「设置 → 通知提醒」，缺任一能力时插件自动降级为纯提醒（无设置页），不影响功能。

### 快捷裁决怎么走通的

通知按钮（`actions`）只属于 Service Worker 弹的持久通知，往 `new Notification()` 里传 `actions` 会直接抛 `TypeError`——这是绕不开的浏览器限制。所以 bundle 一份文件干两件事：页面里照常注册提醒工厂，同一份字节再注册成一个只干转信的 Service Worker，把「点了哪个按钮」（同意 / 拒绝 / 点正文）带回页面。真正的裁决发生在页面里，调的是审批卡片自己用的 `PendingApproval.answer('allowed-once' | 'rejected')`，所以「同意」就是「允许一次」，不多放行任何东西。

每条按钮通知按交互 key 记账，一次只认领一条等待；请求被页面里答掉、或被新请求顶替之后，残留通知上的按钮再点也不会误裁，只是安静地关掉。带按钮的通知不设自动消失——审批没裁决就一直留在通知中心里等你。

## 已知限制

- 页面必须开着才会提醒（后台标签/最小化可以；关标签页即失效——浏览器层方案固有限制）。
- 通知经由浏览器弹出，需允许浏览器通知权限，且勿扰模式不能屏蔽它。
- 每次页面加载后第一次出声/弹通知前，需在页面上点击过一次（浏览器自动播放与权限策略）。
- 未授权通知权限时只有提示音与标题标记。
- 快捷裁决按钮要 Service Worker：`http://127.0.0.1`、`https` 可用，`http://192.168.x.x` 这类局域网地址不行；浏览器或桌面宿主不渲染通知按钮时，`window.__dshNotifyMe.debug()` 的 `bridge` 字段会说明原因，通知自动退回无按钮样式，其余功能不受影响。
- macOS：浏览器里提醒、提示音、标题标记、点通知跳转都没有平台假设，照常工作；但 DSH Desktop（Electron）的系统通知要求应用已签名，未签名的通知直接发不出去，官方 macOS 版是否满足这一前提未实测；审批按钮在 macOS 与桌面宿主上的渲染同样未实测，不渲染时自动退回无按钮通知。
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

## License

MIT — 见 [LICENSE](LICENSE)。
