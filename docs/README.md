# docs

这里放的是仓库自己的材料，插件运行用不到：npm 包的 `files` 白名单只有 `lib/`、`cordis.patch.yml`、两份 README、`CHANGELOG.md` 和 `LICENSE`。

| 路径 | 内容 | 什么时候要动 |
| --- | --- | --- |
| `listing.md` | 各插件市场条目的文案与提交状态 | 提交或修改市场条目时 |
| `brand/` | 图标源文件、各尺寸位图、重新生成脚本 | 改图标时，取舍见 [`brand/README.md`](brand/README.md) |
| `contributors/` | README 致谢表用的头像 | 有人新增贡献、要进致谢表时 |
| `screenshots/` | README 里的界面截图 | DSH 设置界面改版后重拍 |
| [`compatibility.md`](compatibility.md) · [`compatibility.en.md`](compatibility.en.md) | 宿主兼容性全篇：逐版实测记录、代际形状差异、两个会静默失效的坑 | 适配新宿主版本后 |
| [`console-config.md`](console-config.md) · [`console-config.en.md`](console-config.en.md) | 控制台配置键、`decide()` / `testExternal()` 接口、外部通知目标字段 | 新增或改名配置项时 |

README 只保留这两节的摘要与链接，完整内容在对应的 `.md` / `.en.md` 里。

## 截图

三张图都取自本机 Windows 上的真实界面，宽度 592 px：

| 文件 | 尺寸 | 内容 |
| --- | --- | --- |
| `settings-zh.png` | 592×1006 | 中文设置页完整面板（1.17.0） |
| `settings-en.png` | 592×1024 | 英文设置页完整面板（1.17.0） |
| `notify-toast.png` | 593×239 | Edge 里的普通通知，不含审批按钮 |

README 用的是 `raw.githubusercontent.com` 绝对地址，换图后 Markdown 里的链接不用改。`screenshots.json` 是提交插件市场时给的一套图列表，换图时一并同步。

## 头像

`contributors/` 里每位贡献者一张 48×48 PNG，文件名就是 GitHub 用户名，README 里按 40×40 显示。加人时改动两处：这里的图片，和 README 中英两份的致谢表。
