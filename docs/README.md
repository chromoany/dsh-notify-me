# docs

这里放的是仓库自己的材料，插件运行用不到：npm 包的 `files` 白名单只有 `lib/`、`cordis.patch.yml`、两份 README、`CHANGELOG.md` 和 `LICENSE`。

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

三张图都取自本机 Windows 上的真实界面：两张 settings 图宽 648 px（1.21.6 重拍），`notify-toast.png` 宽 593 px：

| 文件 | 尺寸 | 内容 |
| --- | --- | --- |
| `settings-zh.png` | 648×1162 | 中文设置页完整面板（1.21.6） |
| `settings-en.png` | 648×1180 | 英文设置页完整面板（1.21.6） |
| `notify-toast.png` | 593×239 | Edge 里的普通通知，不含审批按钮 |

两张 settings 图 1.21.6 重拍：面板自 1.19.0 起只有页脚版本行变过，这次按 1.21.6 重截，页脚是 `dsh-notify-me v1.21.6`。设置界面再改版时按当版重截并同步上表。

README 用的是 `raw.githubusercontent.com` 绝对地址，换图后 Markdown 里的链接不用改。`screenshots.json` 是提交插件市场时给的一套图列表，换图时一并同步。

## 头像

`contributors/` 里每位贡献者一张 48×48 PNG，文件名就是 GitHub 用户名，README 里按 40×40 显示。加人时改动两处：这里的图片，和 README 中英两份的致谢表。

图片必须**先把圆形抠好**：48×48、四角 alpha 为 0。GitHub 网页上头像显示成圆的，但 README 里嵌的是裸 PNG，交一张方图进去就是方角，不会有任何裁切。做法是把 `AgMahone.png` 的 alpha 通道当遮罩套到新图上，全表共用同一个圆（连边缘那一圈抗锯齿都一致），不要各自画。验证：`Image.open(p).split()[3]` 四个角取值为 0（套同一遮罩时实心像素约 1724 个，个别图边缘抗锯齿差几个）。
