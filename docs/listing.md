# 上架渠道与状态（列表收录）

本文件记录 dsh-notify-me 在 DSH 插件目录/市场里的收录状态，以及各渠道的收录方式。插件本身的安装方式见 README（`dsh plugin --profile web add dsh-notify-me`）。

## 各渠道的收录方式

| 渠道 | 收录方式 | 提交物 | 合并方式 |
| --- | --- | --- | --- |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（`awesome-dsh-plugin.com`，`dshmarket` 数据源） | 提 PR | `data/plugins/<owner>__<repo>.yml`，一条一个文件 | 维护者人工合并（批量处理） |
| [imsai-sh/awesome-deepseek-harness-plugins](https://github.com/imsai-sh/awesome-deepseek-harness-plugins)（`deepseek1024.com`） | 提 PR | `catalog/plugins/<owner>--<repo>.json` | 机器人 `static-review` 通过后**仍需维护者点合并**（bot 原文 "maintainer review required"），但实测合并常在数分钟内完成（最近 12 个 PR 的"提交→合并"均为 0.0h） |
| DSH-Store（`dsh.store`） | Issue 模板投稿 | Issue 表单 | 人工 |

两条通用规则：

- **仓库侧**：`package.json` 必须声明 `dsh.bundle.patch`（只有 `dsh.client` 不可安装），并给仓库加 `dsh-plugin` topic。
- **npm 侧**：只在仓库里被收录不等于可安装。目录类站点通常从 npm 解析安装命令；包没发到 npm 之前条目是 browse-only（只显示仓库链接）。

## 本插件的当前状态

- npm：`dsh-notify-me` 已发布，`latest` 为 1.16.0（1.16.0 = 回应 [#23](https://github.com/chromoany/dsh-notify-me/issues/23)：可按对话静音——会话行悬停出铃铛、标题前划掉的铃铛标记、设置页「会话静音」卡片，列表存在本地配置并随心跳交给宿主兜底，关掉标签页后也不会为静音的对话发提醒；1.15.0 = 收编 [#25](https://github.com/chromoany/dsh-notify-me/pull/25)（回应 [#24](https://github.com/chromoany/dsh-notify-me/issues/24)）：两个默认关的宿主侧可选模块——页面关闭后的兜底推送与同源中继，指向网关的直连目标自动折叠到同源中继，`unverified` 的文案与原因写清；1.14.7 = 「恢复默认设置」写不进去时也会报「设置没能保存」；文档补 Linux 通知中心、外部推送的取消重试与服务码判定、致谢新增 #21/#22 并把贡献者头像统一成同一套圆形遮罩；1.14.6 = 抬窗路由的闸门接受监听器自己绑定的那个 IP（只绑局域网网卡时桌面端也能抬窗），消失的会话不再无限保留基线；1.14.5 = 收尾 1.14.4 审计出的缺陷：外部推送关掉后不再继续重试、飞书 / Server酱 / WxPusher 的服务码与 2xx 非 JSON 判定修正、配置写入失败会在设置页说明、审批测试通知的按钮不再 6 秒失效、权限弹窗关掉后还能再问；宿主半的路由测试不再依赖本机 DSH；1.14.4 = 桌面端抬窗按平台分流：Windows 继续走宿主路由，macOS / Linux 恢复 `dsh://open` 隐藏 iframe 深链（issue #21），`debug().raiseChannel` 改为按平台直接算；同版修掉两处「测试按钮谎报已发送」（通知权限被拒、Service Worker 异步拒收），存储里的配置不是对象时回落默认值；1.14.3 = 回应 issue #20：当前会话的通知正文改用侧栏真实标题——此前「回复完成」正文与「需要你」的会话行对当前会话写死占位符「当前对话 / Current conversation」，其他会话却带标题；现在当前会话也从同一条列表行取标题，只有列表还没给出标题的新会话才回落占位符；1.14.2 = 回应 issue #18：桌面端「测试「审批按钮」」的通知 tag 67 字符超过 Windows 64 上限、构造抛错被空 catch 吞掉而设置页仍写「已发送」——现在所有 tag 按 `location.origin` 算出的平台前缀占位统一收口（超长保留前缀 + FNV-1a base36 尾哈希），平台拒收记进 `debug().lastToastReject` 并让测试按钮如实报错；1.14.1 = 修 1.14.0 路由的 CSRF 口径：那个自定义头挡不住 DNS rebinding（rebinding 页面与目标地址同源、能带任意头也不触发预检），换成三层闸门——对端地址必须 loopback、`Host` 必须是 loopback 名（`127.0.0.1` / `localhost` / `[::1]`，可带端口）、带 `Origin` 时必须与 `Host` 同源，不符回 `403` 且 `reason` 写明 `bad-remote` / `bad-host` / `cross-origin`；`OPTIONS` 一律 `405`、从不回 CORS 头；1.14.0 = 桌面端抬窗换实现：删掉 1.5.2 起的 `dsh://open` 深链隐藏 iframe，改成宿主侧 exact 路由 `POST /__dsh-notify-me/focus-window` + 宿主 spawn 一次 PowerShell（`lib/focus-window.ps1`）做 Win32 原生激活（已在前台不动作 / `SW_RESTORE` / 合成 ALT 键 + `SetForegroundWindow` / 最小化-恢复兜底），实测窗口最小化、被盖住都能抬回来，路由带 header 校验与 `501`/`403`/`405` 拒绝、400 毫秒合并、8 秒超时；1.13.0 = 回应 issue #17 的「安卓端收消息」诉求：外部推送新增飞书群机器人 / Server酱（Turbo 与 Server酱³）/ WxPusher 三种目标，明显临时的失败按 2 秒 / 6 秒退避重试、重试仍失败进失败记录，每个目标可单独启停并显示最近一次投递结果，飞书按官方算法签名、自定义目标可带 HMAC 签名，消息模板可自定义；钉钉因接口不放行 CORS 且只收 `application/json`，页面内无法投递，文档里说明用自建中转；1.12.0 = 收编 [#16](https://github.com/chromoany/dsh-notify-me/pull/16)：人在前台但闲置 `idleMinutes`（默认 3 分钟）也算离开、「回复完成」提醒时机 `donePolicy` 三选一、通知自动消失 `autoDismiss` 三档，并删掉 1.11.0 残留的页内审批卡片（审批提醒从此只走系统通知，点通知回对话裁决）；1.11.0 = 删掉「提醒方式」二选一：系统通知成唯一通道，设置页不再有「通知类型」，桌面端审批卡片保留并改由「审批卡片位置」控制；1.10.7 = 撤销 1.10.6 的「浮层通道在后台补发系统通知」：选了浮层就只画页面卡片，后台只有提示音和标题标记，不再越权弹系统通知；1.10.5 = 桌面端窗口只是被别的应用盖住、没最小化时，「回复完成」提醒不再被当成"人还在看"而丢掉：窗口失焦即算后台，失焦瞬间也补发此前被压下的审批提醒；1.10.4 = 桌面端拿不到 Service Worker 时，审批的「同意 / 拒绝」按钮改画在窗口角落的页内卡片上，12 秒回收、同一审批不叠卡，Web 端不变；1.10.3 = 桌面端同类普通通知只弹第一条（Electron 不认 `renotify`，改为每条独立 tag）；1.10.2 = 提醒方式做成一行分段选择器，系统通知 / 浮层提醒二选一；1.10.1 = 悬浮提示触发区收窄到标题文字本身，浮层位置与音量改成点标题展开，普通提醒 5 秒自收、带按钮 12 秒；1.10.0 = 提醒方式改二选一（系统通知 / 页面浮层单选，旧配置自动迁移），停留时间收紧、带按钮的卡片也会自动消失；1.9.5 = 桌面端抬窗口径改为「不稳定」（隔离复测：深链 3/3 无效）；1.9.3 = 悬浮提示只在行标题文字上触发，停在开关/滑块上不再弹；1.9.2 = 设置页说明改成悬浮提示，行内只留标题；1.9.1 = 设置左侧导航行图标换成品牌铃铛；1.9.0 = 品牌标志 `docs/brand/` + 设置页重排：页眉 / 提醒方式 / 什么时候提醒 / 试一试 / 折叠的高级设置，2026-10-20 发布；publish 返回 `PUT 202` 后约 1 分钟才在 registry 可读，属正常处理延迟），manifest 带 `dsh.bundle.patch` 与 `dsh.compatibility.dshReleases`（`0.2.1-rc.2` 宿主不再读取该字段，装不装只看 `peerDependencies` 与 `engines`）。
- imsai-sh / deepseek1024.com：条目 `catalog/plugins/chromoany--dsh-notify-me.json` 已合入 `main`（`added: 2026-09-09`），`Catalog sync` 工作流在每次 main 推送后自动跑。**2026-09-11 扩写条目描述以提升站内可搜性（PR #400，`static-review` 已通过、待合并）**：原描述里没有「消息提醒 / 桌面通知 / 提醒 / message alerts / reminder」，用户搜这些词完全命中不到——机制见下节。
- awesome-dsh-plugin：条目文件 `data/plugins/chromoany__dsh-notify-me.yml` 在 **PR #4741**（`Submission gate` 绿；唯一红的 `check` 是仓库级构建失败，与本条目无关），**仍未合并**。2026-09-11 核查结论：该站**自 2026-09-09 03:13Z 起站点构建失败、数据停更在 09-08**（registry 顶层 `updated: 2026-09-08`、`count: 3408`、最大 `added: 2026-09-08`），且 **09-09 03:26Z 之后零合并**（`merged:>=2026-09-09T04:00:00Z` 精确等于 0）。反证：09-09 已合并的 #4591 `xtd1145/dsh-deepseek-cost-live`、#4495 `dearbld/dsh-living-memory`、#4503 `dsh-todo-float-ball` 在站点上**同样 404**。故"搜不到"是整条队列停滞，不是本条目被拒。

## 仓库侧要求的实际执行口径

awesome-dsh-plugin 的 README（面向投稿者）写的是「仓库创建满 1 天且提交数 ≥ 10」，但同仓库的 `contributing.md` 与 `scripts/check-submission.mjs` 只保留年龄门槛：提交数门槛已于 2026-09-03 取消（上游 #4196，理由是历史长短反映开发习惯而非质量）。CI 实际只校验 `dsh.bundle`、仓库年龄与「不是 DSH 本体」，`dsh.client` 单独声明不算可安装。

## 判断「为什么在站点上搜不到」的三件套（2026-09-11 实测有效）

1. **数据快照日期**：`https://awesome-dsh-plugin.com/plugins.json` 顶层 `updated` 字段即站点数据的截止日期（`added` 不会超过它）。加 `?cb=<时间戳>` 重取结果一致 → 排除 CDN 缓存（该站是静态托管，文件本身没重生成）。
2. **条目页 + 对照实验**：`https://awesome-dsh-plugin.com/p/<owner>/<repo>/` — 200 = 已上站，404 = 未生成。关键是用**「已经被合并的别人的条目」**做对照组：若它们也 404，说明是全站停更，不是自己这一条被拒。
3. **上游是否还在合并**：GitHub 搜索 API `repo:awesome-dsh-plugin/awesome-dsh-plugin is:pr is:merged merged:>=<ISO 时间>`。配合 `main` 的 HEAD 提交时间一起看。

**三种绿色都不能当成"已上架"**：PR 上的 `check: success` 只代表该 PR **自己分支**的 CI 通过（自带构建修复的分支天然是绿的）；`Submission gate: success` 是 `pr-gate.yml` / `regate.yml` 每几小时自动重跑的**资格闸门**，与收录无关；只有 PR 页面上的紫色 `Merged` 才是真合并，而**合并仍不等于上站**——站点要等 `build-site` 成功重建。

## deepseek1024 站内搜索的匹配范围（2026-09-11 实测，用于解释「为什么搜不到」）

- **只匹配这几处**：官方文档 `imsai-sh/dsh-1024store` → `web/docs/api.md` 原文，`q` 匹配 **package name、owner、repository、monorepo plugin id 的子目录段、category、以及条目 description 的 en/zh 两种语言**。⇒ **GitHub 仓库的 description、topics、README 一律不参与索引。** 决定性对照：`消息提醒` 与 `message alerts` 都写在仓库描述里，实测前者全站仅 2 条（均非本插件）、后者全站 **0 条**。
- **条目 schema 只有 7 个字段**（`$schema, id, name, repository, category, description, added`），**没有 keywords / tags** ⇒ `description` 是唯一可扩词的字段。
- **默认 `sortBy=stars`**，本项目 stars=1 ⇒ 大词永远沉底（`通知` 260 条、`提醒` 134、`notify` 497，均不在前 100）；只有**长尾精准词**（`消息提醒`、`桌面通知`、`完成提醒`）能进首页。所以描述要写用户真会搜的长词，而不是只写文雅的同义表达。
- 复现验证：`https://api.deepseek1024.com/v1/plugins/search?q=<词>&limit=100`（`limit` 上限 100；`sortBy` 支持 `stars` / `installCount` / `downloads` / `name` / `recent`），看 `total` 与结果里是否含 `chromoany/dsh-notify-me`。

## 详情页显示 browse-only 是怎么回事（2026-09-11 实测）

- 详情页文案 `This plugin has not published an npm package…` = 该条目**没有安装命令**，只给仓库链接。
- 真实判定在站点 worker：`imsai-sh/dsh-1024store` → `web/worker/lib/install-methods.ts`。**有 npm 方法当且仅当 registry 上该包声明了 `dsh.bundle`**；`github:` 源安装仍被记录，但**不再对用户展示**（由 `offeredInstallCommand` 过滤为 npm）。站点侧 npm 事实含 `packageName / binding / bundleDeclared / version / checkedAt`，其中 `binding`（repository 回指是否匹配）**不影响可见性**。
- ⚠️ **PR 评论里 bot 那段「Install availability / browse-only」与真实判定无关，别被它误导**：`scripts/review-plugin-submission.mjs` 第 440 行对**每个被审阅条目无条件**追加该 advisory（`installAvailabilityAdvisory()` 只接收包名、套一段固定文案，**不做任何 npm 查询**），文件注释自称 "reported, never enforced"、"a LABEL, not an admission test"。
- **实测对照**（2026-09-11，同日收录的条目）：stars 42k / 36k / 1.1k 的三个仓库**当天就显示 npm 命令**；6 个低星或无独立 npm 包的条目全是 browse-only；1 star 的我们（09-09 收录）同样是 browse-only，而 npm 包体检**完全合规**（`dsh.bundle.patch` ✅、非 deprecated、tarball HEAD 200、包名 = 仓库名、repository 回指正确）。**推断（未从站点代码确证）**：站点按仓库热度排队重算 npm 事实，低星仓库滞后；`catalog-sync.yml` 虽有每日 `cron: '15 5 * * *'`，但**不保证**重算 npm 事实。
- ⇒ 遇到 browse-only 先别改任何东西：bot 已明说 "detects a newly published package automatically; **no follow-up pull request is needed**"。几天后仍是 browse-only 再去找维护者。

## 维护提示

`awesome-dsh-plugin` 的站点由 `scripts/build-site.mjs` 生成。该脚本从两处 `git log` 推导条目的收录日期，**默认不 diff merge commit**，因此「由 merge commit 引入的条目文件」会推导失败并让构建以 exit 1 中止；一旦构建失败，站点与目录包（`dsh-plugin-catalog`）都不会更新，所有 PR 的 `check` 也会一起挂。上游 issue：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/issues/4731>。若该站长时间不更新，先看 `build-site.yml` 最近一次运行，而不是怀疑自己的条目文件。
