# docs

这里放的是仓库自己的材料，插件运行用不到：npm 包的 `files` 白名单只有 `lib/`、`cordis.patch.yml`、三份 README（`README.md` / `README.en.md` / `README.zh-TW.md`）、`CHANGELOG.md` 和 `LICENSE`。

| 路径 | 内容 | 什么时候要动 |
| --- | --- | --- |
| `listing.md` | 各插件市场条目的文案与提交状态 | 提交或修改市场条目时 |
| `brand/` | 图标源文件、各尺寸位图、仓库头图与社交预览、重新生成脚本 | 改图标或换头图时，取舍见 [`brand/README.md`](brand/README.md) |
| `contributors/` | README 致谢表用的头像 | 有人新增贡献、要进致谢表时 |
| `screenshots/` | README 里的界面截图 | DSH 设置界面改版后重拍 |
| [`compatibility.md`](compatibility.md) · [`compatibility.en.md`](compatibility.en.md) | 宿主兼容性全篇：逐版实测记录、代际形状差异、两个会静默失效的坑 | 适配新宿主版本后 |
| [`console-config.md`](console-config.md) · [`console-config.en.md`](console-config.en.md) | 控制台配置键、`decide()` / `testExternal()` 接口、外部通知目标字段 | 新增或改名配置项时 |

README 只保留这两节的摘要与链接，完整内容在对应的 `.md` / `.en.md` 里。

## 截图

四张图都取自本机 Windows 上的真实界面：三张 settings 图宽 648 px（1.23.0 重拍），`notify-toast.png` 宽 593 px：

| 文件 | 尺寸 | 内容 |
| --- | --- | --- |
| `settings-zh.png` | 648×1162 | 简体中文设置页完整面板（1.23.0） |
| `settings-zh-tw.png` | 648×1162 | 繁體中文设置页完整面板（1.23.0，`README.zh-TW.md` 用） |
| `settings-en.png` | 648×1180 | 英文设置页完整面板（1.23.0） |
| `notify-toast.png` | 593×239 | Edge 里的普通通知，不含审批按钮 |

三张 settings 图 1.23.0 重拍：面板外观自 1.19.0 起只有页脚版本行变过（1.23.0 新增的繁體语言项在默认折叠的「高级」里，Android 的 Worker 退路不改变外观），这次按 1.23.0 重截，页脚是 `dsh-notify-me v1.23.0`。字号、间距与旧图一致，逐像素差异只在文字抗锯齿。设置界面再改版时按当版重截并同步上表。

README 用的是 `raw.githubusercontent.com` 绝对地址，换图后 Markdown 里的链接不用改。

## 头像

`contributors/` 里每位贡献者一张 48×48 PNG，文件名就是 GitHub 用户名，README 里按 40×40 显示。加人时改动两处：这里的图片，和 README 中英两份的致谢表。
