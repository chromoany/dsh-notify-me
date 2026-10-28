# 控制台高级配置

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
  mutedSessions: [],          // 按对话静音的会话 id 列表（侧边栏铃铛写入，重载后仍在）
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
> `debug().hostBridge` 是宿主协调的只读快照：`state`（`idle` 还没探到；`active` 宿主有兜底、本页正用心跳占住租约；`unavailable` 宿主在但没有兜底，默认安装即如此——路由没注册的 404 也算这一档，不是故障；`error` 宿主答不出可用回包，或被闸门直接拒了）、`leaseMs`（宿主授予的租约，毫秒）、`relayEnabled` 与 `relayPath`（宿主启用了中继时给出它的路径）、`relayUpstreamHost` / `relayUpstreamPath`（中继上游网关的主机名与路径，即会被折叠的那个端点）、`lastReason`（上一次探测失败的原因，如 `bad-host` / `cross-origin` / `http-403`，正常时为 `null`）、`lastProbeAt` / `lastBeaconAt`（最近一次探测与心跳的时间，ISO 字符串或 `null`）。闸门拒绝算 `error` 而不是「未启用」，因为那是能自己修的配置：把本页来源补进 profile 里 `- id: notify-me` 顶层的 `allowedOrigins`。

</details>

---

[← 返回 README](../README.md)
