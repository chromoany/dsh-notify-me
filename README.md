# dsh-notify-me

DSH（DeepSeek Harness）web GUI 的**桌面提醒**插件：当你切到别的软件、看不到 DSH 页面时，在"模型需要你操作"和"回复完成"两种时刻提醒你。

| 时刻 | 提醒 | 默认 |
|---|---|---|
| 🔔 需要你操作 | 审批请求 / 方案待确认（plan review）/ 提问（`ask_user_question`） | 页面可见也提醒 |
| ✅ 回复完成 | 一次回复（turn）跑完；后台会话完成也提醒 | 仅页面隐藏/后台时提醒 |

提醒方式（浏览器层实现，**需要 DSH 页面保持打开**）：

- **系统通知**：Windows 通知中心 Toast（点通知可切回 DSH 窗口）
- **提示音**：Web Audio 合成提示音（需先在页面上点击过，浏览器才允许发声）
- **标签页标题标记**：有待处理提醒时标题前出现 `🔔 需要你 · …`

## 安装

```powershell
# 从 npm 安装（发布后）
dsh plugin --profile web add dsh-notify-me

# 或本地开发安装（指向本项目目录）
dsh plugin --profile web add "D:\chromoany\dsh-notify-me"
```

然后**重启 dsh web**（新增插件需重启后进入页面清单），刷新页面即生效。

### 首次授权

第一次在 DSH 页面上**点击**（或按键）时，浏览器会请求"显示通知"权限，选**允许**，否则只有提示音没有系统通知。误点拒绝后：点地址栏左侧锁 → 站点设置 → 通知 → 允许 → 刷新。

### 快速自测

切到别的软件（让页面隐藏）后，在 F12 控制台执行：

```js
window.__dshNotifyMe.test("attention")   // "需要你"提醒
window.__dshNotifyMe.test("done")        // "完成"提醒
```

## 设置（F12 控制台）

```js
window.__dshNotifyMe.config                       // 查看
window.__dshNotifyMe.setConfig({
  attentionHiddenOnly: false, // true = 页面可见时"需要你"不提醒
  doneHiddenOnly: true,       // false = 页面可见时"完成"也提醒
  toast: true,                // 系统通知开关
  sound: true,                // 提示音开关
  volume: 0.5,                // 音量 0~1
  autoFocus: true             // 点通知切回 DSH 窗口
})
window.__dshNotifyMe.resetConfig()                // 恢复默认
```

## 卸载

```powershell
dsh plugin --profile web remove dsh-notify-me
```

然后重启。

## 工作原理

浏览器半身订阅客户端 `sessions` 服务：

- 当前会话 `ConversationSnapshot`：`running` true→false = 回复完成；`pending[]` 出现 `approval / plan-review / question` = 需要你操作；
- 其余会话列表摘要：`pendingInteraction` 出现 / `completed` 边沿 = 后台会话需要你或已完成。

无 React/UI、无 settings 命名空间依赖；偏好存 `localStorage`（键 `dshNotifyMe.config`）。

## 发布与上架

```powershell
# 1. 登录 npm（npmjs.com 注册账号后）
npm login

# 2. 打包并发布（files 白名单已限制包内容）
npm pack --dry-run   # 先看包里有什么
npm publish
```

发布后即可：`dsh plugin --profile web add dsh-notify-me`。

**上架 dshmarket（插件市场）**：市场数据源为 [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com) 的 `plugins.json`（GitHub 仓库维护），收录后可在 设置 → 插件市场 被搜索到（"notify" 类目）。提交入口与要求见仓库 CONTRIBUTING；通常需要：npm 已发布 + GitHub 仓库 + 在 plugins.json 里按字段新增一条记录（类别 `notify`）。

## 目录结构

```
package.json       插件声明（dsh.client / exports ./client / bundle patch / files 白名单）
cordis.patch.yml   loader 条目（id: notify-me, name: dsh-notify-me）
lib/index.js       服务端半身（空壳，仅为 loader 条目存在）
lib/client.js      浏览器半身：通知 / 声音 / 标题标记 + sessions 订阅
smoke/             离线冒烟测试（node smoke/smoke-test.cjs）
LICENSE            MIT
```

## 开发自检

```powershell
node --check lib\client.js
node --check lib\index.js
node smoke\smoke-test.cjs   # 全绿表示状态机逻辑正常
```

## 局限与替代

- 浏览器层方案：页面必须开着（最小化/后台可以）。若需"浏览器全关也能收到"的 Host 层原生 Windows 通知，可另装 Host 层通知插件。
- 本插件代码完全自包含、可审计（无第三方运行时依赖，未执行任何本机命令）。
