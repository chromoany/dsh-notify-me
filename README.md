<div align="center">

<img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/brand/icon-app-128.png" width="76" height="76" alt="dsh-notify-me">

# dsh-notify-me

**离开 DSH 页面，也能及时知道何时需要回来。**

简体中文 | [English](README.en.md)

[![npm version](https://img.shields.io/npm/v/dsh-notify-me?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/dsh-notify-me)
[![npm downloads](https://img.shields.io/npm/dm/dsh-notify-me?style=flat-square&label=downloads%2Fmonth&color=1F883D)](https://www.npmjs.com/package/dsh-notify-me)
[![npm total downloads](https://img.shields.io/npm/dt/dsh-notify-me?style=flat-square&label=total%20downloads&color=1F883D)](https://www.npmjs.com/package/dsh-notify-me)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![test](https://github.com/chromoany/dsh-notify-me/actions/workflows/test.yml/badge.svg)](https://github.com/chromoany/dsh-notify-me/actions/workflows/test.yml)
[![DSH Web and Desktop](https://img.shields.io/badge/DSH-Web%20%7C%20Desktop-blue?style=flat-square)](#安装)
[![Package size](https://img.shields.io/npm/unpacked-size/dsh-notify-me?style=flat-square&label=package%20size)](https://www.npmjs.com/package/dsh-notify-me)
[![DSH Compatibility](https://img.shields.io/badge/DSH-%E5%B7%B2%E9%80%82%E9%85%8D%200.2.1--rc.2-6366f1.svg?style=flat-square)](#兼容性)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

</div>

[安装](#安装) · [效果预览](#效果预览) · [配置](#在-dsh-设置里改配置) · [兼容性](#兼容性) · [已知限制](#已知限制) · [更新日志](CHANGELOG.md)

DSH Web / Desktop 的通知插件，让你敢不开完整访问，也不必一直守着页面。

- **需要你操作时**：审批、方案确认、提问，用通知、提示音和标题标记提醒。
- **后台回复完成时**：及时回来查看结果，点击通知可回到对应对话；提醒时机可选「仅后台 / 仅当前对话静默 / 总是提醒」。
- **人走开但窗口没走**：窗口留在最前台、人却离开座位，超过 3 分钟没有输入也算离开，该提醒的照常提醒；收到的那条通知不会在你回来之前自己消失。
- **离开电脑时**：可选转发到 Discord、Bark、Gotify、飞书群机器人、Server酱、WxPusher 或自己的 Webhook。
- **连页面都关掉时**：可选让宿主进程兜底——页面不在时宿主继续把「需要你操作」「回复完成」推到你的网关；也可以只开同源中继，让页面够到要认证的网关。两项默认关，配置写在 profile 的 patch 层（见[高级设置](#高级设置)里的「页面关闭后：宿主侧兜底与同源中继」）。

> 页面或桌面应用需保持运行（后台 / 最小化可以）；系统通知需要通知权限。审批按钮依赖 Service Worker，只有 Web 端有，桌面端的通知不带按钮，点通知回到对话里裁决。开启宿主侧兜底后，页面关闭仍能收到外部推送——本地通知与审批按钮仍要页面在。

## 效果预览

![Windows 上经 Edge 显示的 DSH 普通通知，未包含审批按钮](https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/screenshots/notify-toast.png)

*普通通知示例 · Windows / Edge · 不含审批按钮。* [查看原图](https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/screenshots/notify-toast.png)

<details>
<summary>展开设置界面预览</summary>

![通知提醒设置页：页眉、提醒方式、什么时候提醒、试一试与折叠的高级设置](https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/screenshots/settings-zh.png)

只截插件自己的面板（真实组件，与宿主同款深色主题），不带 DSH 左侧导航栏；每行说明在鼠标停在标题文字上时才出现，所以这里只看到标题。

</details>

## 安装

### DSH Web

已安装 DSH CLI 的用户，在终端执行：

```sh
# 安装并自动挂载进 web profile
dsh plugin --profile web add dsh-notify-me
```

重启 `dsh web`，然后硬刷新页面（Windows / Linux 是 Ctrl+Shift+R，macOS 是 Cmd+Shift+R）。如果你使用其他 Web profile，请把命令中的 `web` 换成实际名称。

### DSH Desktop

1. 在桌面应用打开 **插件 → 添加插件**。
2. 输入 npm 包名 `dsh-notify-me`，按应用提示完成安装，并确认插件已启用。
3. 完全退出并重新启动 DSH Desktop，使插件加载。

桌面端的 `desktop` profile 由 Electron 应用管理；不要把上面的 Web 命令改成 `--profile desktop`，CLI 会拒绝此操作。安装到 Web profile 也不会自动安装到桌面端。

## 首次验证

1. 在 DSH 页面上点击一次，按提示允许通知；若此前拒绝过，在浏览器站点设置中允许通知。操作系统也需要允许对应浏览器 / DSH Desktop 显示通知。
2. 打开 **设置 → 通知提醒**，确认出现该分区及底部插件版本号，保持「启用提醒」「提示音」开启。
3. 点击设置页的「测试『回复完成』」按钮：应出现一条测试通知，并按当前音效设置播放声音。这个本地测试不会转发到外部通知端点，也不受「窗口在前台时也提醒」开关限制。

Web 用户可再测审批按钮，通知上会带「同意 / 拒绝」。桌面端拿不到 Service Worker，这条测试只发一条普通通知；真实审批的提醒同理——只弹通知，点它回到对话里裁决。

**控制台验证（可选）** — 支持 DevTools 的环境也可执行：

```js
window.__dshNotifyMe.test("done")        // 「完成」示例
window.__dshNotifyMe.test("attention")   // 「需要你」示例
window.__dshNotifyMe.test("approval")    // 桥可用时带「同意 / 拒绝」按钮；否则只发普通通知（桌面端即如此）
window.__dshNotifyMe.debug()             // 桥接看 bridge（active = 按钮可用）、抬窗通道 raiseChannel、最近一次尝试 raiseLast、平台拒发原文 lastToastReject、设置是否真存下来 configStored、宿主协调看 hostBridge
```

没有测试通知时，先检查：通知权限是否被拒绝（在页面上点一下 → 选「允许」；或地址栏锁 → 站点设置 → 通知 → 允许 → 刷新）、装完没重启 DSH、系统设置里浏览器通知被关。

## 为什么需要它

- **不开完整访问（`workspace-write` + ask）**：保留事前审批，但错过请求会让 agent 等待。
- **开完整访问（full access）**：减少审批打断，同时放弃事前拦截能力。

dsh-notify-me 把「监督」和「守在屏幕前」解耦：只在真的出现决策点（审批 / 方案确认 / 提问）或回复跑完时，才用系统通知把你叫回来——**让你敢不开完整访问**，不必靠放弃拦截能力来换效率。它不降低 full access 本身的权限风险（它不是沙箱），只是减少 ask 模式下因错过审批而产生的等待。

## 提醒时机

| 事件 | 默认行为 |
| --- | --- |
| 🔔 需要你操作 | 页面可见也提醒；当前对话只留标题标记 |
| ✅ 回复完成 | 页面隐藏 / 后台时提醒（可选「仅当前对话静默」或「总是提醒」） |

**需要你操作**包括审批请求、方案待确认（plan review）和提问（`ask_user_question`）。带按钮的快捷裁决只在 Web 端可用，桌面端点通知回到对话里裁决（见[已知限制](#已知限制)）。

**回复完成**也覆盖后台会话；完成但还没看时，标题带 `✅ 回复完成 ·` 标记，打开对应会话即撤。标题标记不受提醒策略限制。

通知正文的第一行是会话标题：当前正在看的会话和其他会话一样显示自己的标题，只有宿主还没给出标题的新会话才用「当前对话」占位符兜底。

> **后台**子代理（subagent）子会话的等待与完成默认**不提醒**：DSH 把每个子代理子会话列成独立会话，但它们是所属主对话那一轮里的步骤，提醒只会是噪音。你当前打开的那个子代理会话不算在内，照常提醒。设置页「子代理会话不提醒」可关掉这个静音。

## 在 DSH 设置里改配置

打开 **设置 → 通知提醒**。页面按「提醒方式 → 什么时候提醒 → 试一试」三段排开，不常改的收进底部「高级设置」，点一下展开。每行只写标题，具体说明在鼠标停在标题文字上时弹出的小方框里（只有标题本身触发布局，整行空白处不会弹；触屏或键盘操作时留一份隐藏文本给读屏）。带 ▸ 的行点一下展开子项。

### 提醒方式

- **启用提醒** 总开关：关闭后不弹通知、不响提示音，也不改标签页标题；
- **提示音 / 音量**：开关直接切；音量滑块收在该行里，点一下标题（▸ 变成 ▾）展开。具体播什么由「高级设置 → 音效来源」决定；
- **审批通知上直接裁决**（默认开）：审批带「同意 / 拒绝」，点一下即完成裁决，不用切回页面。Web 走带按钮的系统通知；桌面端 `dsh-app://` 注册不了 Service Worker，通知上没有按钮，点通知回到对话里裁决。设置页「试一试」下面那行会如实说明当前环境能不能给按钮。

### 什么时候提醒

- **窗口在前台时也提醒「需要你」**（默认开）：关掉后只有窗口转到后台才提醒；
- **当前对话不弹通知**（默认开）：正看着的对话里的等待只留标签页标记，人离开后照常补发；
- **「回复完成」什么时候提醒**（默认「仅后台」）：仅后台 / 仅当前对话静默 / 总是提醒，三选一；
- **通知自动消失**（默认「离开时保留」）：离开时保留 / 总是关闭 / 从不关闭，三选一；
- **子代理会话不提醒**（默认开）：跳过后台子代理（subagent）会话，你正开着的那个照常提醒；
- **点击通知回到对应对话**（默认开）：切到对应对话并把窗口带到前台，Windows 桌面走宿主路由原生抬窗、macOS / Linux 走 `dsh://open` 深链，多个标签页只调起一个。

<details>
<summary>展开各开关的边界条件</summary>

- **后台的判定**：切到别的应用、被别的窗口盖住、最小化都算；窗口一直留在前台但 3 分钟没有任何键鼠输入同样算，`idleMinutes: 0` 退回只看窗口。
- **「当前对话不弹通知」何时补发**：窗口转到后台或闲置超时后照常提醒；若你已处理掉就作废。
- **「回复完成」三档**：「仅后台」＝不在看页面才提醒；「仅当前对话静默」＝屏幕上那条静默、别的对话照常提醒，多开对话时有用；「总是提醒」＝从不静默。老配置里的「窗口在前台时也提醒『回复完成』」开关自动迁移到这一项。
- **「离开时保留」**：你人在页面前时，普通通知几秒后自己收；人不在时收到的那条留在通知中心等你回来。带「同意 / 拒绝」的通知不设自动撤回，留到你点按钮、回页面把请求答掉、或被新请求顶替为止；桌面端画不出按钮的审批通知按 12 秒收，人不在时同样不撤。
- **点击通知的兜底**：桌面端抬不起来时只切对话，原因记在 `debug().raiseLast` 里；关掉这一项后点通知不做任何事。

</details>

### 试一试

三个按钮分别发一条「需要你」「回复完成」「审批按钮」测试提醒，用当前设置立即发，**不受**「什么时候提醒」里的开关限制；下方一行如实说明当前哪种渠道能给审批按钮。

设置页底部常显插件版本号（`dsh-notify-me v…`）——报障、核对是否装上新版本时直接照抄这一行。

### 高级设置

默认收起，点一下展开。里面收着三块不常改的东西：音效来源、外部推送、运行环境与诊断——分别见下面三节。

#### 音效

「需要你」与「回复完成」可独立选择内置合成音（默认）、自定义音频文件或系统通知音。自定义音频上限 1 MiB，存在浏览器本地，可试听与移除；选系统通知音时完全不播插件音效，通知照发，声音交给操作系统（音色跟着系统通知设置走），此时「试听」会改发一条测试通知。任一来源缺文件、读不出来或存不下时回落到内置合成音，提醒不会变成哑的。

#### 外部推送

默认关闭。支持 Discord Webhook / Bark / Gotify / 飞书群机器人 / Server酱（Turbo 与 Server酱³）/ WxPusher / 自定义 Webhook；提醒正文会发往你填写的地址，只使用可信端点。

<details>
<summary>目标地址、转发开关、发送测试与失败记录</summary>

- **外部通知**（默认关）：把提醒同时转发到你自己的推送端点，人不在电脑前也能收到；可加多个目标，每个目标可单独启停。「转发「需要你」」「转发「回复完成」」各自独立开关；**发送测试通知**往所有目标发一条测试消息（不受这两类开关限制，也不会冒充真提醒）。转发跟本地提醒走同一套触发规则（「当前对话不弹通知」等开关同样管它）；提醒正文会原样发往你填的地址，**只填你自己信任的端点**；
- **各目标的填法**：Discord 填 Webhook 地址；Bark 填 `https://api.day.app/<设备密钥>`；Gotify 填 `https://<服务器>/message?token=<应用令牌>`；飞书填群机器人 Webhook，可选填签名校验密钥；Server酱 填 `…/send/<SendKey>.send` 完整地址；WxPusher 填 appToken 与接收者 UID；自定义端点收一条 POST JSON：`{source, event, title, body, text, sessionId, time}`；
- **可靠投递**：明显是临时故障的失败（网络中断、5xx、429）按 2 秒 / 6 秒自动重试两次，其它错误立即停；关掉「外部通知」总开关或删掉某个目标后，已经排在定时器上的重试立刻作废，既不算失败也不进失败记录；重试仍失败会把这一条记进「失败记录」（最多 10 条，只留标题与正文摘要和主机名，不留完整端点），设置页能一眼看到并清空；
- **服务码与「不可确认」**：飞书 / Server酱 / WxPusher 的 2xx 还会读返回体里的服务码（飞书与 Server酱是 `0`，WxPusher 是 `1000`），码不对按失败记并带服务端文案；2xx 但正文不是该服务的 JSON（空白、代理或 WAF 的网页）记「已送出不可确认」，不冒充成功；
- **每个目标的状态**：目标行右侧显示它最近一次投递的结果（上次成功 / 上次已送出但不可确认 / 上次失败 + 原因），并各自带一个启停开关——某个端点临时不可用就单独关掉它，不用关掉整类事件；
- **签名**：自定义目标填了签名密钥时，请求带 `X-DSH-Notify-Signature`（对请求体做 HMAC-SHA256，`sha256=<hex>`）；飞书填了签名密钥时按官方算法在请求体里带 `timestamp` / `sign`；
- **消息模板**（可选）：飞书 / Server酱 / WxPusher / 自定义目标可填模板，占位符 `{{title}}` `{{body}}` `{{event}}` `{{time}}` `{{session}}`，留空默认是「标题 + 换行 + 正文」；
- **钉钉不在支持列表里**：钉钉群机器人接口不返回任何 CORS 头，且只接受 `application/json`——浏览器页面既读不到响应，也无法发出符合要求的请求（no-cors 下 Content-Type 会被限制成 safelisted 类型）。要用钉钉，请在自己能控制的机器上搭一个中转，再把「自定义 Webhook」指向它。

</details>

#### 页面关闭后：宿主侧兜底与同源中继

这两块能力住在宿主进程里（`lib/host-fallback.js`、`lib/relay.js`，都是包内的可选模块），默认关：没有配置时宿主只注册抬窗那一条路由，升级前后行为一致。它们的配置写在 profile 的 patch 层，不在设置页里——它们让宿主替页面干活，不是浏览器偏好；设置页只如实显示探测到的状态。

<details>
<summary>宿主侧兜底：页面关闭后由宿主接着推</summary>

页面不在时页面半体不运行，提醒就断在这里。宿主侧兜底订阅宿主的会话事件流（`session/event`），在页面关闭后自己把同样两条提醒发到你配置的网关。

profile 覆盖示例（`~/.dsh/profiles/<profile>/cordis.patch.yml`）。**`config` 是整块替换、不是深合并**：patch 里写同一个 `id` 就把整个 `config` 赋过去，所以示例把三块都写全——漏写的键会回落到插件内的默认值（与随包 YAML 是同一份），但被一起冲掉的 `gateway.target` 不会自己回来。

```yaml
- id: notify-me
  config:
    allowedOrigins: []            # 顶层：页面入口白名单，留空 = 只接受回环 / 绑定地址（三条宿主入口共用）
    gateway:
      target: ''                  # 例：https://cue.example/notify/<key>
      credentialsFile: ''         # 0600 JSON，见下
      headers: {}                 # 额外请求头，可选
    hostFallback:
      enabled: true
      target: ''                  # 留空 = 用 gateway.target
      credentialsFile: ''         # 留空 = 用 gateway.credentialsFile
      events: ['turn/end', 'approval/asked']
      includeSubagents: false
      turnEndThrottleMs: 15000
      titlePrefix: 'DSH'
      language: 'auto'            # auto | zh | en
      pageLeaseMs: 60000          # 0 = 不与页面协调（页面开着也会重复）
      healthPath: '/__dsh-notify-me/host-fallback'
    relay:
      enabled: false
      path: ''
      target: ''
      credentialsFile: ''
```

逐键说明（括号内是默认值）：

- `enabled`（`false`）：关着时宿主不订阅任何事件，也不注册健康探针；
- `target` / `credentialsFile`（空）：留空回落到 `gateway.*`；两处都空等于没地方可推，模块干脆不挂载，只在宿主日志里留一行 warning——比每次投递都失败好查；
- `events`（`['turn/end', 'approval/asked']`）：要推的事件，只列一种就只有那一种；
- `includeSubagents`（`false`）：`origin === 'subagent'` 的会话默认跳过，理由与页面侧一致——它们是主对话一轮里的步骤；
- `turnEndThrottleMs`（`15000`）：同一会话的「回复完成」在这个窗口内只推一条；窗口只在真发出去时才消耗，被租约挡掉的那次不算；
- **文案与页面通知逐字一致**：标题是 `<前缀> · 回复完成` / `<前缀> · 审批请求`，正文「回复完成」只有会话名、「审批请求」是 `会话名：工具名 · 原因`——不含任何用户消息正文（用户消息里常带注入的 `<system-reminder>`、记忆上下文与时间戳，复制进通知就没法读了）；非正常收尾（`aborted` / `error` / `max-tokens`…）会在正文尾部附一个短后缀，如 `（error）`；
- `titlePrefix`（`DSH`）：标题是 `<前缀> · 审批请求` / `<前缀> · 回复完成`（与页面通知同一套标签）；
- `language`（`auto`）：`auto` 用页面最近一次心跳报的语言，没有心跳才回落到中文；`zh` / `en` 强制；
- `pageLeaseMs`（`60000`）：页面在线租约，见下面「去重」；
- `healthPath`（`/__dsh-notify-me/host-fallback`）：只读健康探针的路径。

**凭据文件**：宿主用户可读的 0600 JSON，内容是 `{"user": "...", "password": "..."}`（按 HTTP Basic 发）或 `{"authorization": "Bearer ..."}`（原样发；裸 token 会自动补上 `Bearer `）。它不能写进 patch 层——那一层世界可读、还会进 profile 目录。不填这个键时请求不带认证头：很多 webhook 端点本来就不要认证，把「没配凭据」当成错误会让每个提醒都失败；只有「配了路径却读不出来」才算凭据不可用。网关回 401 / 403 时宿主丢掉缓存的凭据、重读文件、只重试一次，所以轮换密码不需要重启宿主。

**去重靠一条页面在线租约**：页面加载后 `GET /__dsh-notify-me/host-bridge` 探测一次（之后每 60 秒复探，页面隐藏时不探、回到可见补探一次），只有回包 `hostFallback.enabled === true` 才开始心跳——body 只有 `{alive, language}`，间隔取 `leaseMs/3`、夹在 5–20 秒；`pagehide` 时发一条 `{alive:false}`（带 `keepalive`）立刻释放。宿主侧租约新鲜就不补推（页面自己在推），租约过期或收到 `alive:false` 才接手，最多等 `pageLeaseMs` 这么久。心跳只带语言，不带页面的推送开关：规则是「没有页面持有租约时宿主接手」，而页面的可见性与闲置判定宿主看不见，只照做一半会得到谁也算不清的规则。语言带过来是为了英文页面不收中文宿主提醒，`language: 'auto'` 时生效。`pageLeaseMs: 0` 关掉协调，宿主永远推——页面开着时会收到两份，只在调试时用。

**两个路由的契约**：页面探测的那条 `GET /__dsh-notify-me/host-bridge` 回 `{ok, version, features, hostFallback:{enabled, leaseMs}, relay:{enabled, path}, language, page:{alive, ageMs}}`；它只在 `hostFallback.enabled` 或 `relay.enabled` 为真时注册，默认安装下是 404，页面按「未启用」处理而不是当故障。心跳 `POST` 要求意图头 `x-dsh-notify-me-page: bridge`（缺了回 `403`），坏 JSON 回 `400`，body 超 16 KiB 回 `413`，成功回 `200 {ok, leaseUntil}`。

**健康探针**：`GET <healthPath>` 回 `{ok, version, enabled, events, includeSubagents, pageAlive, lastDelivery: {at, ok, status} | null}`，非 GET / HEAD 回 `405`。它和其它宿主入口共用同一道闸门：对端必须是本机（回环或监听器自己绑定的那个地址），`Host` 必须是回环名 / 绑定地址 / `allowedOrigins` 派生的公网域名，不符回 `403` 并带 `reason`（`bad-remote` / `bad-host` / `cross-origin`）。探针不收凭据、不转发，用它在终端确认「这个宿主进程到底有没有在推、上一次投递是什么结果」。

**走隧道或反代时必须配 `allowedOrigins`**：那种部署下发往宿主的 `Host` 是公网域名而不是回环地址，而 `allowedOrigins` 既是 `Origin` 白名单，也是可接受的 `Host` 来源。不写它，页面的心跳会被闸门判 `bad-host`（设置页那行显示「宿主未响应」，下方直接提示去顶层 `allowedOrigins` 补本页来源），宿主于是把开着页面的提醒也补推一遍——正是租约要避免的那种重复。

</details>

<details>
<summary>同源中继：让页面够到要认证的网关</summary>

页面用自己的 `fetch` 往外部目标推，碰上要 Basic 认证的网关就是死路，三条 CORS 事实各堵一次：

1. 把凭据写进 URL（`https://user:pass@host/…`）：`fetch` 直接抛错，请求根本没发出去；
2. 加 `Authorization` 头：请求变成预检，而 Apprise 这类网关不回任何 `Access-Control-Allow-*`，预检失败；
3. 退到 `no-cors`：带不了自定义头，等于没有认证。

于是页面只能报「已送出不可确认」。同源中继把这一段搬到宿主：页面 POST 到与自己同源的路由，宿主补上凭据再打网关，然后把网关的真实状态回给页面。

启用需要 `relay.enabled: true`、`relay.path`（必须是绝对路径）、`relay.target`（留空回落到 `gateway.target`）和 `relay.credentialsFile`（留空回落到 `gateway.credentialsFile`）。路径本身就是能力——知道它就能让宿主替你发一条通知，价值等同口令，所以建议带一段随机 token：`/__dsh-notify-me/relay/<32 hex token>`。

用法：**设置 → 通知提醒 → 高级设置 → 外部推送** 里多出两行只读状态，「同源中继」一行显示 `已启用 · 地址：<origin><relay.path>`；把那个绝对地址填进同页「自定义 Webhook」目标的地址即可，页面不必知道凭据。

不想改地址也行：**「自定义 Webhook」目标里如果填的是中继上游网关本身的地址，发送时会自动折叠到中继路由**。这类地址在浏览器里注定失败（上面三条 CORS 事实各堵一次，其中 `no-cors` 兜底还会被 Apprise 当成跨站请求直接 `403 Cross-site request rejected`），旧版把它记成 `unverified`——设置页显示「上次已送出（不可确认）」、测试按钮报「已送出不可确认」，**而手机一声不响**。折叠之后请求走同源、凭据由宿主补，回执就是网关的真实状态。折叠只发生在目标类型为「自定义」且 URL 的主机名等于 `relay.upstreamHost` 时；别的主机一律原样直发（中继只把东西送到它自己的网关），设置页会在会被折叠的目标下写一行说明。

走隧道 / 反代时中继要和桥接路由过同一道 `Host` 闸门：把页面的公网来源写进顶层 `allowedOrigins`，否则探针与 `POST` 都会被判 `bad-host`。

回包口径（页面据此把「已送出不可确认」变成可核对的状态）：

- `GET` / `HEAD` `<relay.path>` → `200 {ok, route, version, enabled}`：只读探针，不转发、不带凭据，但**和其它宿主入口走同一道闸门**——路径本身就是能力，不设闸门的探针会把「猜对了」告诉猜的人；拿它确认「这个进程挂的是不是我配的那条路径」；
- `POST` → 读 body（上限 64 KiB）、要求是 JSON 对象，映射成网关的 `{title, body, type:'info'}`（页面载荷里的 `tag` 不透传：Apprise 把 tag 当服务过滤，不匹配会回 424），附上 `gateway.headers` 与凭据；
- `200 {ok, upstreamStatus, upstreamBody}`（`upstreamBody` 最多 500 字符）＝转发成功；上游非 2xx 回 `502`，同为这一形状；
- `400`（坏 JSON 或空 body）、`413`（body 超限）、`405`（方法不对）、`403`（闸门拒绝，`reason` 同上）、`503`（配了凭据文件但读不出来）、`502 {reason:'upstream-error'}`（上游异常）。

凭据只在宿主：页面拿不到它，它也不会回显在响应或日志里。`POST` 走与其它宿主入口同一道闸门，所以跨站页面或 DNS rebinding 的伪造来源即使猜到路径也会被拒。

</details>

#### 运行环境与诊断

在「高级设置」最后一块。默认自动识别当前是 Web 端还是桌面端（DSH Desktop，`dsh-app://`）；识别不准时可手动指定——Windows 桌面点通知走宿主路由做原生抬窗、macOS / Linux 走 `dsh://open` 深链（见[桌面端怎么抬窗的](#桌面端怎么抬窗的)）、通知上不带快捷裁决按钮；Web 端走 `window.focus()` 与 Service Worker 桥。手动覆盖与自动识别不一致时，设置页会明示检测结果。

<details>
<summary>通知语言、桌面端抬窗与恢复默认</summary>

- **通知语言**：跟随界面 / 简体中文 / English——决定通知文字与 `🔔 …` 标题标记使用的语言；
- **桌面端抬窗**：Windows 走宿主路由做原生激活、macOS / Linux 走 `dsh://open` 深链；最小化、被别的窗口盖住的窗口在 Windows 与 Linux 上都实测能抬回来（见[桌面端怎么抬窗的](#桌面端怎么抬窗的)）；
- **恢复默认设置**：把所有开关与音效设置还原成出厂值（不动外部推送目标和已选的自定义音频文件）。

</details>

## 提醒渠道

| 渠道 | 表现 |
| --- | --- |
| 系统通知 | 经浏览器进 Windows / macOS / Linux 的系统通知中心，点击回到对应对话；Web 端可带「同意 / 拒绝」 |
| 提示音 | 默认 WebAudio 合成音，「需要你」与「完成」音型不同；可换自定义音频，或交给系统通知音 |
| 标签页标题 | `🔔 需要你 · …` / `✅ 回复完成 · …`（随通知语言切换），打开对应会话即消失；两种标记可同时出现 |
| 外部推送（可选，默认关） | 把同一条提醒转发到 Discord / Bark / Gotify / 飞书 / Server酱 / WxPusher / 自定义 Webhook |
| 宿主侧兜底（可选，默认关） | 页面关闭后由宿主进程继续把「需要你操作」「回复完成」推到你的网关；要 profile 配置与 0600 凭据文件 |
| 同源中继（可选，默认关） | 页面 POST 到宿主同源路由，由宿主补凭据转发给要认证的网关，并回传网关真实状态码 |

本插件以**浏览器层**为主：本地通知、提示音、标题标记仍只在页面开着时工作（最小化 / 后台即可——那正是它监听的「离开」状态）；开启宿主侧兜底后，外部推送在页面关闭后由宿主进程接着发。

## 兼容性

逐版本适配记录见 [package.json](package.json) 的 `dsh.compatibility.dshReleases`；当前宿主（`0.2.1-rc.2`）的安装门控只读 `peerDependencies` 与 `engines`，**不再读取这个字段**，所以它只是一份给人看的记录，不构成门禁。

已逐版实测**真正激活**于 `0.1.1-rc.2`、`0.1.2-rc.1`、`0.1.5-rc.1`、`0.1.5-rc.2`、`0.2.0-rc.2` 与 `0.2.1-rc.2`（判定标准：插件条目进启动页 `__DSH_BOOT__`、注入依赖解析通过、`/plugins/??dsh-notify-me/client.js&rev=…` 返回含新代码的构建、设置里出现「通知提醒」分区）。`0.1.1-rc.2` 到 `0.2.1-rc.2` 的插件条目照旧兼容，换回旧宿主也不需要改配置；`1.9.0` 的界面重排没有引入新的宿主 API，设置页页眉的铃铛是插件自己画的 SVG（`docs/brand/`）。

<details>
<summary>展开宿主代际的形状差异与两个已知坑</summary>

插件按宿主代际自动选源；下表是各形状的边界，不是门禁：

| 宿主代际 | 「需要你」交互来源 | 判断当前会话 | 点通知切会话 |
| --- | --- | --- | --- |
| `≤ 0.1.2-alpha.1` | 控制器快照的 `pending[]` | 快照 `current` | `sessions.open()` |
| `0.1.2-alpha.2 .. 0.1.6-alpha.1` | `uiSession.pendingInteractions` | 快照 `current` | `sessions.open()` |
| `≥ 0.1.6-alpha.2`（含 `0.2.0-rc.2`、`0.2.1-rc.2`） | `uiSession.sessionStatus` | `retainedBy.mainView` | `uiWorkspace.openSession()` |

区间仅作示意：插件按 store 形状自动选源（`sessionStatus` 存在即走新路），版本号只是各形状的出现边界。`peerDependencies` 范围决定 npm 的 peer 提示——`0.2.1-rc.2` 已落在 `>=0.2.0-rc.1 <0.3.0-0` 里，不需要豁免。

`0.2.1-rc.2` 另跑了一轮隔离验证：隔离 `DSH_HOME` 起 `dsh web`（70 个启动条目），插件条目排第 59、`application` 批，三个注入目标都在且都排在它前面；`client.js` 返回 1.7.0 源码构建（140,153 B）；无头 Chromium 载入后 `apply` 正常执行，`debug()` 报 `uiSession: bound`、`uiSessionSource: sessionStatus`、`bridge: active`。宿主侧形状与 `0.2.0-rc.2` 一致，不需要改代码。

两个坑值得记住：一是 `dsh.client.inject` 里列了新版运行时已不再提供的包，客户端条目会停在 `pending (waiting for services: …)` 而永不执行——1.1.3 在 `0.1.2-rc.1` 及以后正是这样失效的；二是宿主换存储或字段名时**不会报错**，提醒只会静默失效——`pendingInteractions`→`sessionStatus`、`list.current`→`retainedBy.mainView`、`sessions.open()`→`uiWorkspace.openSession()` 都是这一类，所以每次适配都要用 `window.__dshNotifyMe.debug()` 确认真的是 `bound`。

</details>

## 控制台高级配置

设置页是第一入口；想脚本化/批量改或恢复默认时，偏好存 `localStorage`（`dshNotifyMe.config`），可用控制台实时调整：

<details>
<summary>展开控制台 API 与存储说明</summary>

```js
window.__dshNotifyMe.config                       // 查看
window.__dshNotifyMe.setConfig({
  enabled: true,           // false = 关闭所有提醒（主开关）
  language: "auto",        // 'auto' 跟随界面 | 'zh' 简体中文 | 'en' English
  attentionHiddenOnly: false, // true = 页面可见时「需要你」不提醒
  currentHiddenOnly: true,    // true = 当前对话的等待只留标题标记（人离开后补发）
  donePolicy: "background",   // 「回复完成」策略：'background' 仅后台 | 'smart' 仅当前对话静默 | 'always' 总是提醒
  idleMinutes: 3,             // 超过多少分钟没有键鼠输入算「离开」（0 = 关掉闲置判定）
  autoDismiss: "present",     // 通知自动消失：'present' 离开时保留 | 'always' 总是关闭 | 'never' 从不关闭
  ignoreSubagent: true,       // true = 后台子代理（subagent）会话不提醒（当前打开的照常）
  sound: true,                // 提示音开关（含「系统通知音」模式）
  soundDone: "synth",         // 「完成」音效来源：'synth' 内置 | 'custom' 自定义文件 | 'system' 系统通知音
  soundAttention: "synth",    // 「需要你」音效来源，取值同上
  volume: 0.5,                // 音量 0~1
  autoFocus: true,            // 点通知回到提醒所属的对话
  quickActions: true,         // 审批通知上的「同意 / 拒绝」按钮
  hostEnv: "auto",            // 运行环境：'auto' 自动识别 | 'desktop' 强制桌面端 | 'web' 强制 Web
  externalEnabled: false,     // 外部通知转发主开关（默认关：不填端点就什么都不发）
  externalAttention: true,    // 转发「需要你」（触发规则跟本地提醒完全一致）
  externalDone: true,         // 转发「回复完成」
  externalRetryDelays: [2000, 6000], // 可重试失败的退避间隔（毫秒，带抖动；[] = 只发一次）
  externalTargets: []         // 推送目标，见下方字段说明
})
// 目标的形状：{id, type, url, secret?, token?, uid?, template?, enabled?}
// type: 'discord' | 'bark' | 'gotify' | 'feishu' | 'serverchan' | 'wxpusher' | 'custom'
// token/uid 只用于 wxpusher（url 固定为官方端点）；secret 用于飞书签名与自定义 HMAC 签名；
// template 可选，占位符 {{title}} {{body}} {{event}} {{time}} {{session}}；enabled:false 单独停用该目标
window.__dshNotifyMe.resetConfig()                // 恢复默认（同时清掉已选的自定义音效文件）
window.__dshNotifyMe.decide("approval:3", "allowed-once")  // 程序化裁决："allowed-once" | "rejected"
window.__dshNotifyMe.testExternal()               // 显式外发测试：向有效目标发送，返回 {sent, unverified, failed, statuses}
```

> **外部通知测试的开关边界**：设置页「发送测试通知」要求「启用提醒」与「外部通知」主开关开启，但忽略两类提醒的转发开关。控制台 `testExternal()` 是显式测试调用：只要配置了有效目标，即使上述主开关关闭，也会向这些目标发送测试消息；没有有效目标则不发送。普通的 `test("done")` / `test("attention")` / `test("approval")` 只测试本地提醒，不外发。

> 自定义音效文件不在 `dshNotifyMe.config` 里，而是按类别各存一个键（`dshNotifyMe.sound.done` / `dshNotifyMe.sound.attention`，内容是 `{name, size, data}` 的 data URL）——一个文件转成 data URL 会膨胀约 1.37 倍，塞进配置会拖慢每次读取。`resetConfig()` 会连这两个键一起清掉。
>
> 想确认当前生效的来源，看 `window.__dshNotifyMe.debug()` 的 `soundDone` / `soundAttention` 与 `customSoundDone` / `customSoundAttention`。
>
> `debug().hostBridge` 是宿主协调的只读快照：`state`（`idle` 还没探到；`active` 宿主有兜底、本页正用心跳占住租约；`unavailable` 宿主在但没有兜底，默认安装即如此——路由没注册的 404 也算这一档，不是故障；`error` 宿主答不出可用回包，或被闸门直接拒了）、`leaseMs`（宿主授予的租约，毫秒）、`relayEnabled` 与 `relayPath`（宿主启用了中继时给出它的路径）、`lastReason`（上一次探测失败的原因，如 `bad-host` / `cross-origin` / `http-403`，正常时为 `null`）、`lastProbeAt` / `lastBeaconAt`（最近一次探测与心跳的时间，ISO 字符串或 `null`）。闸门拒绝算 `error` 而不是「未启用」，因为那是能自己修的配置：把本页来源补进 profile 里 `- id: notify-me` 顶层的 `allowedOrigins`。

</details>

## 工作原理

提醒核心监听会话状态与待处理交互；审批裁决由页面侧完成，Windows 桌面抬窗走宿主路由加 Win32 原生激活、macOS / Linux 走 `dsh://open` 深链。

<details>
<summary>展开事件来源与降级说明</summary>

提醒核心按宿主代际取源（见上表），当前会话一律来自客户端 `sessions` 服务：

- **当前会话** `SessionSnapshot`：`running` true→false = 回复完成；
- **待办交互**：`uiSession` 的 `sessionStatus`（`≥ 0.1.6`，逐会话 `pendingInteraction`）或 `pendingInteractions`（`0.1.2 .. 0.1.5`）出现新 key = 模型在等你，容器里带上审批工具名 / 理由、提问文本；旧宿主回落到控制器快照的 `pending[]`；
- **其它已列会话**摘要：`running` true→false（或旧宿主的 `completed` 边沿）= 后台工作提醒。宿主的「完成未读」级别标志负责补漏与标题标记：`≥ 0.1.6` 用 `sessionStatus` 行的 `completionUnread`（后台会话完成即点亮、打开该会话/再次开跑/会话消失即清零），旧宿主用列表行的 `completed` 提醒位（选中会话即清零）；页面没看见的完成边沿（插件热重载中途、快照合并跳变）由此补报一次，边沿与级别标志同来时按短时间窗合并，只响一声。
- **子代理会话**：列表行带 `origin: 'subagent'`（并有 `parentId`）的**后台**会话默认静音；你正打开着的那个子代理会话不算静音对象，它的提醒走当前对话的常规规则（页面可见时默认只留标题标记、转后台补发），切进来时积压的等待同样补上，切走后重新静音。只有 `parentId`、没有 `origin` 的分支（fork）会话属于你自己的对话，始终照常提醒。

提醒核心仍然零第三方运行时依赖、完全自包含：通知文字按所选语言（跟随界面 / 中文 / English）即时解析。设置页是**可选**的 React 呈现层——当 DSH web profile 提供 `slots` / `locale` / `react` 时才注册进「设置 → 通知提醒」，缺任一能力时插件自动降级为纯提醒（无设置页），不影响功能。

</details>

### 快捷裁决怎么走通的

带「同意 / 拒绝」按钮的通知只能由 Service Worker 弹出（往 `new Notification()` 里传 `actions` 会直接抛 `TypeError`），所以 bundle 的同一份文件再注册成一个只干转信的 worker，把「点了哪个按钮」带回页面。**裁决仍在页面里发生**，调的是审批面板里「允许一次 / 拒绝」用的同一个 `PendingApproval.answer('allowed-once' | 'rejected')`——「同意」就是「允许一次」，不多放行任何东西。

<details>
<summary>展开按钮通知的记账与调窗口</summary>

每条按钮通知按交互 key 记账，一次只认领一条等待；请求被页面里答掉、或被新请求顶替之后，残留通知上的按钮再点也不会误裁，只是安静地关掉。带按钮的通知不设自动撤回，等你点按钮或把请求答掉才消失；普通通知 5 秒自收，桌面端没有按钮的审批通知 12 秒自收。「通知自动消失」选「从不关闭」时，这两类都不收。没来得及点就回页面里裁决，对话里的审批一直等着你。

点正文的「调窗口 + 切对话」也归 worker 这半侧调度：`client.focus()` 只调起一个窗口（优先当前可见的），也只让那个窗口切对话——多个 DSH 标签页不会互相抢焦点或一起乱切。

</details>

### 桌面端怎么抬窗的

DSH Desktop 是一层 Electron 壳，页面跑在 `dsh-app://app` 下：DOM 的 `window.focus()` 只动浏览器窗口对象、碰不到原生窗口，壳的 `will-navigate` 又把页面里发 `dsh:` 的常规出口堵上了。插件按平台走两条通道：Windows 走插件自己的宿主路由——页面 POST `/__dsh-notify-me/focus-window`，宿主起 `powershell.exe` 跑 `lib/focus-window.ps1`，由它枚举原生窗口、自适应激活；macOS / Linux 走壳自己的 `dsh://open` 深链——页面在点击手势里插一个隐藏 iframe 导航 `dsh://open`（子框架导航不经过壳的顶层 `will-navigate` 拦截），交给系统协议注册，壳的 `second-instance` / `open-url` 处理器据此 restore + show + focus 主窗口。Windows 上这条深链在 `0.2.1-rc.2` 复测 3/3 无效，1.14.0 起改走宿主路由；Linux（Plasma 6.8 / Wayland）已实测能把最小化或后台的窗口抬回前台，macOS 未实测。

<details>
<summary>展开路由、激活顺序、实测数据与安全闸门</summary>

Windows 的宿主路由：壳把 `dsh-app://app` 下除静态资源以外的所有路径原样转发给宿主 HTTP server（带 origin 校验、注入宿主 cookie），所以上面那个 POST 是同源请求，没有 CORS 问题；宿主半（`lib/index.js`）本来就跑在 Electron 主进程的子进程里，`process.ppid` 就是主窗口所属的浏览器进程。点通知时：页面 POST → 宿主起一次 `powershell.exe` 跑 `lib/focus-window.ps1 -ProcessId <ppid>` → 脚本枚举该 pid 下可见、无 owner、非 toolwindow 的顶层窗口（优先类名 `Chrome_WidgetWin_1`，再按 `GetWindowRect` 面积取最大）→ 自适应激活 → 比对 `GetForegroundWindow()` 打印 `FOCUSED=1|0` → 宿主回 `200` / `202`。

Windows 的激活顺序是实的：已经在前台就什么都不做（最常见的情况，零闪烁）；最小化了先 `SW_RESTORE`；然后合成一次 ALT 按键（`keybd_event` 按下抬起）给本线程前台权限，再 `SetForegroundWindow`；这一串都不行才退到 `SW_MINIMIZE` + `SW_RESTORE` 兜底。单独调 `SetForegroundWindow` 会被前台锁直接拒，按调用算、跟 `ForegroundLockTimeout` 无关；这也重新解释了 1.5.2 那套深链「时灵时不灵」——能抬起来的那些次，多半是系统在通知被点击时自己激活了应用。

实测（`powershell.exe` 5.1，同一轮跑完）：窗口在前台 ×3、最小化 + 记事本在前台 ×3、可见但被盖住 ×3，全部 `FOCUSED=1` 且前台窗口比对一致，最小化那几个的 `IsIconic` 都从 `true` 变回 `false`；记事本最大化完全遮挡、最小化 + 完全遮挡、`-ProcessId 0` 自动探测同样成功。脚本内部耗时最坏 434 ms，进程启动到退出最坏 782 ms，都在 8 秒上限内；`pwsh` 7.6 对照一轮行为一致，只是 `Add-Type` 编译慢约 100 ms（脚本刻意不用 7 的语法）。不存在的 pid、存在但没有可见窗口的 pid 都稳定 `FOCUSED=0` 并 `exit 0`。

安全上只开一条 exact 路由。词表之外的请求一律拒：非 GET / HEAD / POST 回 `405`（包括预检的 `OPTIONS`，且从不回任何 CORS 头），非 Windows 宿主（Web 版、macOS / Linux、纯 Node）回 `501`（macOS / Linux 走深链，不经过这条路由），缺 `x-dsh-notify-me-focus: focus` 头回 `403`。

那个头只是「这是页面发来的」标记，不是防线——DNS rebinding 的恶意页对目标地址而言是同源的，能带任意自定义头、也不触发预检。真正的闸门是三层：对端地址必须是 loopback，或恰好是监听器自己绑定的那个 IP；`Host` 必须是 loopback 名（`127.0.0.1` / `localhost` / `[::1]`，可带端口）或同一个绑定地址，因为壳转发时 `host` 已被删掉、由 fetch 按它拨号的 URL 重填，而 rebinding 的页面 Host 仍是攻击者域名；带了 `Origin` 就必须和 `Host` 同源。任一条不符回 `403`，`reason` 分别是 `bad-remote` / `bad-host` / `cross-origin`。`GET` 只回 `{ok, route, enabled, desktop, platform}`，装完可以先用浏览器打开确认路由在不在。400 毫秒内的重复调用合并成一次，脚本超过 8 秒没回话就 kill 掉按失败处理。

抬不起来的几种场合与[已知限制](#已知限制)里列的一致（提权窗口、另一虚拟桌面、前台被反复抢走、`SW_HIDE` 托盘隐藏），一律如实回 `202`、对话照常切。

</details>

## 已知限制

**运行前提**

- 默认只在页面开着时提醒（后台标签 / 最小化可以，关标签页即失效——浏览器层方案固有限制）。开启宿主侧兜底后，页面关闭仍能收到**外部推送**：它要 profile 里 `hostFallback.enabled: true`、`gateway.target`（或 `hostFallback.target`）与一个 0600 凭据文件，而且宿主进程自己在跑。
- 通知经由浏览器弹出，需允许浏览器通知权限；每次页面加载后第一次出声 / 弹通知前要先在页面上点过一下；未授权时只剩提示音与标题标记。
- 系统通知横幅只画在主屏：Windows 没有设置项、Chromium 没有 API 能把它指到别的显示器（多屏时副屏收不到）。要跨屏只能靠外部推送转到手机（1.12.0 起页面里不再画审批卡片）。
- 配置存在浏览器 `localStorage`：换浏览器 / 设备或清除站点数据后回到默认值（设置页可一键恢复默认）。

**平台差异**

- 快捷裁决按钮要 Service Worker：`http://127.0.0.1`、`https` 可用，`http://192.168.x.x` 这类局域网地址不行；**桌面端（`dsh-app://`）已实测无法注册 Service Worker**（宿主未开放 `allowServiceWorkers` 特权），审批通知退回无按钮样式。宿主不渲染通知按钮时，`debug()` 的 `bridge` 字段会说明原因，其余功能不受影响。
- Windows 的系统通知标签上限 64 字符，而 Chromium 交给平台的是 `n#<origin>#<tag>` 整串——桌面页面 `dsh-app://app` 一项就占去 16 个。插件按当前 `location.origin` 算剩余预算，超长时保留可读前缀、尾部换成短哈希，所以 `debug()` 里看到的标签可能被截短；平台仍然拒发时，原文记在 `debug().lastToastReject`，设置页的测试按钮也会如实报出来，不再「提示已发送但什么都没弹」。
- 桌面端（Windows）点通知后窗口仍可能抬不起来：目标窗口属于更高完整性级别（提权 / UAC）、在另一个虚拟桌面、前台被别的进程反复抢回去，或窗口被 `SW_HIDE` 隐藏到托盘时，宿主脚本回 `FOCUSED=0`、路由回 `202`，对话照常切（详见[桌面端怎么抬窗的](#桌面端怎么抬窗的)）。
- 桌面端（macOS / Linux）点通知依赖 `dsh://open` 深链：系统未注册 `x-scheme-handler/dsh`、或壳没有 `second-instance` / `open-url` 处理时抬不起来；Linux 上已实测正常，macOS 未实测。
- macOS：提醒、提示音、标题标记、点通知跳转都没有平台假设，照常工作；但 DSH Desktop（Electron）的系统通知要求应用已签名，未签名的通知直接发不出去，官方 macOS 版是否满足这一前提未实测；审批按钮在 macOS 桌面宿主上的渲染同样未实测（Windows 桌面端已实测不渲染）。

**提醒内容与时机**

- `≥ 0.1.6`（含 `0.2.0-rc.2`、`0.2.1-rc.2`）的「回复完成」提醒正文只有会话名，不再附带回复摘要——宿主快照已不再提供 `nodes`；提醒本身照常触发。
- 标题标记由宿主与插件共同写 `document.title`：宿主重算标题时标记可能被覆盖，直到下一次提醒事件重新写成。
- 「当前对话不弹通知」按「窗口是否在前台」判定：被别的应用盖住、切到别的应用、最小化都算后台；回到前台或重新有键鼠输入后恢复静默。

**外部推送**

- 受浏览器跨域（CORS）限制：端点不放行时自动降级为「送出但不可确认」（no-cors），如实标为「已送出不可确认」；Discord、飞书、Server酱、WxPusher 放行跨域，可直接确认送达。钉钉不放行任何 CORS 头、又只收 `application/json`，页面发不出去，所以没有做成目标类型（自建中转 + 自定义目标才行）。临时失败（网络中断、5xx、429）按退避重试，重试仍失败进失败记录，其余错误立即停、不重试；转发在本地提醒决定要发之后才触发，所以被静音的提醒也不会外发。
- 同源中继补上的只是「页面够不到要认证的网关」这一类：页面 POST 到同源路由，宿主补凭据并回传网关的真实状态码。仍然成立的边界有几条——中继与宿主侧兜底都要求宿主进程在运行（`dsh web` 或桌面端主进程），它们不是独立守护进程，宿主退出就都停；宿主跑在代理环境里时网关域名要进 `no_proxy`，否则投递会绕到代理出去；兜底只补外部推送，本地系统通知、提示音、标题标记与审批按钮仍要页面在；`pageLeaseMs: 0` 是调试开关，页面开着也会收到两份；中继路由路径等同于口令，别让它出现在公开记录里。

**设置页图标补丁**

- 左侧导航行图标靠 DOM 补丁：外壳按分区 id 硬编码图标且 `settings.section` 没有图标字段，插件只能在面板渲染后把那一行的 `<svg>` 换成铃铛。命中依赖宿主当前的面板结构（`data-shortcut-modal="settings"` + 导航按钮里的标签 `<span>`），DSH 改了这套结构就会静默回落到默认齿轮，其余功能不受影响。标志与命名的取舍见 [docs/brand/README.md](docs/brand/README.md)。

## 开发自检

```sh
node --check lib/client.js
node --check lib/index.js
npm test                         # smoke-test（状态机）+ host-route-test（宿主半路由）+ page-bridge-test + host-fallback-test + relay-route-test + cordis-host-test
npm pack --dry-run               # 预览发布包
```

`smoke/smoke-test.cjs` 是离线状态机测试：三代宿主 + 主开关 + 中英语言用例 + 快捷裁决桥（Service Worker 半侧一并跑）+ 闲置判定与通知自收 + 通知标签长度收口 + 页面侧 host-bridge 探测/心跳/释放与 `debug().hostBridge` 形状。`smoke/host-route-test.mjs` 不需要本机 DSH，`lib/index.js` 的路由、探针与 403/405/501 闸门在任何平台都会跑。

新增的三个套件同样自带假 `ctx`、不联网、不需要本机 DSH：`smoke/page-bridge-test.mjs` 跑页面桥接路由的状态回包形状、心跳与释放、缺意图头 `403`、跨源 `403`、坏 JSON `400`、超长 `413`，以及 `allowedOrigins` 派生的 `Host`（模拟隧道）放行与路径冲突；`smoke/host-fallback-test.mjs` 跑宿主兜底——审批去重、`turn/end` 节流、子代理跳过、租约新鲜时不发、租约过期后发、`alive:false` 后立刻发、语言跟随心跳、401 后重读凭据、健康探针；`smoke/relay-route-test.mjs` 跑中继——`GET` 探针、`405`、跨源 `403`、`413`、`400`、`503`、`200` / `502` 映射与「401 只重试一次」。

改到 `lib/focus-window.ps1` 时（仅 Windows），另需手动跑一次：

```powershell
powershell -NoProfile -File lib/focus-window.ps1 -ProcessId 0   # 末行应是 FOCUSED=1
```

`cordis-host-test.mjs` 会从本机 DSH 安装借 `@deepseek-ai/cordis`（依次探测 npm 全局目录、`~/.dsh/profiles/web/node_modules` 与 `~/.dsh/profiles/node_modules` 平铺回退目录）；源码 checkout 里没有 profile 依赖时，用 `DSH_CORDIS_PATH=<checkout>/vendor/cordis/lib/index.js` 指定即可。

## 致谢与贡献须知

| 贡献者 | 贡献 |
|:---:|:---|
| <a href="https://github.com/AgMahone"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/AgMahone.png" width="40" height="40" alt="@AgMahone"></a> | [#7](https://github.com/chromoany/dsh-notify-me/pull/7)：宿主代际兼容（0.1.6+ / 0.2.0）的报障与复测 |
| <a href="https://github.com/d0ublecl1ck"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/d0ublecl1ck.png" width="40" height="40" alt="@d0ublecl1ck"></a> | [#8](https://github.com/chromoany/dsh-notify-me/pull/8)：子代理会话静音（`ignoreSubagent`），含测试与文档 |
| <a href="https://github.com/EliteOtaku"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/EliteOtaku.png" width="40" height="40" alt="@EliteOtaku"></a> | [#9](https://github.com/chromoany/dsh-notify-me/issues/9)：桌面端抬窗链路的逐层排查与真实壳复测 |
| <a href="https://github.com/Wh1stle05"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/Wh1stle05.png" width="40" height="40" alt="@Wh1stle05"></a> | [#10](https://github.com/chromoany/dsh-notify-me/pull/10)：「音效来源」（内置合成音 / 自定义音频 / 系统通知音） |
| <a href="https://github.com/yanzhaohui1999"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/yanzhaohui1999.png" width="40" height="40" alt="@yanzhaohui1999"></a> | [#13](https://github.com/chromoany/dsh-notify-me/issues/13) / [#14](https://github.com/chromoany/dsh-notify-me/pull/14)：多会话下空闲页面占用 CPU 的性能报告与修复 |
| <a href="https://github.com/RiZhiZhaoYi"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/RiZhiZhaoYi.png" width="40" height="40" alt="@RiZhiZhaoYi"></a> | [#12](https://github.com/chromoany/dsh-notify-me/issues/12)：外部通知转发（Discord / Bark / Gotify / 自定义 Webhook） |
| <a href="https://github.com/yuexian7"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/yuexian7.png" width="40" height="40" alt="@yuexian7"></a> | [#17](https://github.com/chromoany/dsh-notify-me/issues/17)：安卓端收消息的诉求，促成飞书 / Server酱 / WxPusher 三种目标 |
| <a href="https://github.com/shrekcg"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/shrekcg.png" width="40" height="40" alt="@shrekcg"></a> | [#16](https://github.com/chromoany/dsh-notify-me/pull/16)：离开判定 `idleMinutes`、「回复完成」判定 `donePolicy`、自动消失 `autoDismiss` |
| <a href="https://github.com/Donald-Yip"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/Donald-Yip.png" width="40" height="40" alt="@Donald-Yip"></a> | [#18](https://github.com/chromoany/dsh-notify-me/issues/18)：Windows 通知 tag 超过 64 字符上限、审批测试通知被平台静默拒收的报告 |
| <a href="https://github.com/dunxuan"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/dunxuan.png" width="40" height="40" alt="@dunxuan"></a> | [#20](https://github.com/chromoany/dsh-notify-me/issues/20)：当前会话的通知正文用占位符、未取会话标题的报告 |
| <a href="https://github.com/unnamed42"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/unnamed42.png" width="40" height="40" alt="@unnamed42"></a> | [#21](https://github.com/chromoany/dsh-notify-me/issues/21) / [#22](https://github.com/chromoany/dsh-notify-me/pull/22)：Linux 上 `dsh://open` 抬窗失效的报障与补丁，1.14.4 起 macOS / Linux 恢复深链抬窗 |

署名口径：本仓库收编外部 PR 时以维护者提交落地——不沿用原 commit、不挂 Co-authored-by，GitHub 的 contributors 图只显示维护者，贡献者以上面的致谢署名。

## License

MIT — 见 [LICENSE](LICENSE)。
