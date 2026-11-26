# docs

这里放的是仓库自己的材料，插件运行用不到：npm 包的 `files` 白名单只有 `lib/`、`cordis.patch.yml`、`README.md`、`CHANGELOG.md` 和 `LICENSE`。

三份译文（`README.en.md` / `README.zh-TW.md` / `README.ru.md`）也在这个目录，**不要放回仓库根目录**：npm 打包时在根目录 glob `{README,README.*}`，取第一个匹配到的 `.md`（实测是逆字典序，`README.zh-TW.md` 排在 `README.md` 前面），四份并排时 npm 页面上展示的会是繁体版。放在子目录里 glob 不递归，根目录只剩 `README.md`，展示才稳定。

| 路径 | 内容 | 什么时候要动 |
| --- | --- | --- |
| `listing.md` | 各插件市场条目的文案与提交状态 | 提交或修改市场条目时 |
| [`README.en.md`](README.en.md) · [`README.zh-TW.md`](README.zh-TW.md) · [`README.ru.md`](README.ru.md) | 仓库 `README.md` 的英 / 繁 / 俄三份译文 | `README.md` 改动后同步 |
| `brand/` | 图标源文件、各尺寸位图、仓库头图与社交预览、重新生成脚本 | 改图标或换头图时，取舍见 [`brand/README.md`](brand/README.md) |
| `contributors/` | README 致谢表用的头像 | 有人新增贡献、要进致谢表时 |
| `screenshots/` | README 里的界面截图 | DSH 设置界面改版后重拍 |
| [`compatibility.md`](compatibility.md) · [`compatibility.en.md`](compatibility.en.md) · [`compatibility.ru.md`](compatibility.ru.md) | 宿主兼容性全篇：逐版实测记录、代际形状差异、两个会静默失效的坑 | 适配新宿主版本后 |
| [`console-config.md`](console-config.md) · [`console-config.en.md`](console-config.en.md) · [`console-config.ru.md`](console-config.ru.md) | 控制台配置键、`decide()` / `testExternal()` 接口、外部通知目标字段 | 新增或改名配置项时 |
| [`testing.md`](testing.md) · [`testing.en.md`](testing.en.md) · [`testing.ru.md`](testing.ru.md) | 开发自检全篇：九套测试各自覆盖什么、手动检查、`cordis` 依赖怎么处置 | 新增、合并或改名测试套件时 |

README 只保留这三节的摘要与链接，完整内容在对应的 `.md` / `.en.md` / `.ru.md` 里。

## 截图

四张图都取自本机 Windows 上的真实界面：三张 settings 图宽 648 px，`notify-toast.png` 宽 593 px：

| 文件 | 尺寸 | 内容 |
| --- | --- | --- |
| `settings-zh.png` | 648×1162 | 简体中文设置页完整面板（1.24.0） |
| `settings-zh-tw.png` | 648×1162 | 繁體中文设置页完整面板（1.24.0，`README.zh-TW.md` 用） |
| `settings-en.png` | 648×1180 | 英文设置页完整面板（1.24.0；`README.en.md` 与 `README.ru.md` 共用，俄语还没有自己的截图） |
| `notify-toast.png` | 593×239 | Edge 里的普通通知，不含审批按钮 |

三张 settings 图摄于 1.24.0（页脚是 `dsh-notify-me v1.24.0`），四份 README 的图注也都写了这个版本。它们**落后于当前界面**三处：1.25.0 在「什么时候提醒」里加了一行角标开关、测试按钮从三个变成四个，1.27.0 的语言下拉从两档变成五档（`Русский` 在列）。所以图注只描述当时的样子，不要据此判断现在有哪些开关。

重拍时的口径：四张（简体 / 繁體 / 英文 / 俄语各一张设置页）宽 648 px、只截插件自己的面板不带左侧导航、深色主题、页脚版本号是当版；俄语那张拍好后把 `README.ru.md` 的图注和这条表格一起改掉。设置界面再改版时同样按当版重截并同步上表。

README 用的是 `raw.githubusercontent.com` 绝对地址，换图后 Markdown 里的链接不用改。

## 头像

`contributors/` 里每位贡献者一张 48×48 PNG（32 位带 alpha，与其余头像同尺寸），文件名就是 GitHub 用户名，README 里按 40×40 显示。四角必须透明、整张呈圆形：4× 超采样画圆再缩到 48，边缘才平滑；GitHub 返回的头像常是带底色的正方形，落盘后要重做圆形遮罩。加人时改动两处：这里的图片，和四份 README（根目录 `README.md` 与这里的三份译文）的致谢表——四份行数与顺序必须一致。GitHub 的 `avatars.githubusercontent.com` 有时不管扩展名直接返回 JPEG（`dsadw` 那次就是），落盘后按 PNG 重存一遍再进仓库。
