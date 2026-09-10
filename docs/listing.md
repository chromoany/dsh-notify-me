# 上架渠道与状态（列表收录）

本文件记录 dsh-notify-me 在 DSH 插件目录/市场里的收录状态，以及各渠道的收录方式。插件本身的安装方式见 README（`dsh plugin --profile web add dsh-notify-me`）。

## 各渠道的收录方式

| 渠道 | 收录方式 | 提交物 | 合并方式 |
| --- | --- | --- | --- |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（`awesome-dsh-plugin.com`，`dshmarket` 数据源） | 提 PR | `data/plugins/<owner>__<repo>.yml`，一条一个文件 | 维护者人工合并（批量处理） |
| [imsai-sh/awesome-deepseek-harness-plugins](https://github.com/imsai-sh/awesome-deepseek-harness-plugins)（`deepseek1024.com`） | 提 PR | `catalog/plugins/<owner>--<repo>.json` | 机器人静态审查通过后自动 squash 合并 |
| DSH-Store（`dsh.store`） | Issue 模板投稿 | Issue 表单 | 人工 |

两条通用规则：

- **仓库侧**：`package.json` 必须声明 `dsh.bundle.patch`（只有 `dsh.client` 不可安装），并给仓库加 `dsh-plugin` topic。
- **npm 侧**：只在仓库里被收录不等于可安装。目录类站点通常从 npm 解析安装命令；包没发到 npm 之前条目是 browse-only（只显示仓库链接）。

## 本插件的当前状态

- npm：`dsh-notify-me` 已发布，`latest` 为 1.1.3，manifest 带 `dsh.bundle.patch` 与 `dsh.compatibility.dshReleases`。
- imsai-sh / deepseek1024.com：条目 `catalog/plugins/chromoany--dsh-notify-me.json` 已合入 `main`，目录同步工作流已推送。
- awesome-dsh-plugin：条目 `data/plugins/chromoany__dsh-notify-me.yml` 已在 PR 中，等待合并。

## 维护提示

`awesome-dsh-plugin` 的站点由 `scripts/build-site.mjs` 生成。该脚本从两处 `git log` 推导条目的收录日期，**默认不 diff merge commit**，因此「由 merge commit 引入的条目文件」会推导失败并让构建以 exit 1 中止；一旦构建失败，站点与目录包（`dsh-plugin-catalog`）都不会更新，所有 PR 的 `check` 也会一起挂。上游 issue：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/issues/4731>。若该站长时间不更新，先看 `build-site.yml` 最近一次运行，而不是怀疑自己的条目文件。
