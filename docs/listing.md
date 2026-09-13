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

- npm：`dsh-notify-me` 已发布，`latest` 为 1.1.3，manifest 带 `dsh.bundle.patch` 与 `dsh.compatibility.dshReleases`。
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
