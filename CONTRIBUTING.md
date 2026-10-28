# 贡献指南

[English](CONTRIBUTING.en.md)

提交前先判断改动类型：新增功能、改变提醒时机或判定逻辑的改动，请先开 issue 说明场景；文档修正、错字、测试补充可以直接提 PR。

## 环境

- Node.js 18 及以上（见 `package.json` 的 `engines`）。
- 没有构建步骤：`lib/client.js` 直接注入页面，`lib/index.js` 是插件入口，两者都是手写代码。
- 宿主调试依赖本机安装的 DSH，`smoke/cordis-host-test.mjs` 会自行探测；源码 checkout 缺少 profile 依赖时，用 `DSH_CORDIS_PATH` 指向 cordis 的位置（见 README「开发自检」）。

## 提交前必须通过

```sh
npm test          # smoke-test（状态机）+ host-route-test（宿主半路由）+ cordis-host-test（找不到宿主时自动跳过）
npm run pack      # 确认发布包里没有意外文件
```

改到 `lib/focus-window.ps1` 时，另需手动执行一次抬窗脚本，看到 `FOCUSED=1` 才算通。

## 代码约定

- `lib/client.js`：页面侧逻辑。新增用户可见的通知文案，要同时补 `TXT` 的 `zh` 与 `en` 两份；设置面板文案在 `UI_zh` 与 `UI_en` 两处，漏一处会让另一种语言显示中文或空白。
- 新增设置项：在 `DEFAULTS` 加默认值，设置面板渲染与 `smoke/smoke-test.cjs` 的状态机用例各补一处。
- `lib/index.js`：宿主侧逻辑与抬窗回环路由。改动其鉴权条件前请先说明动机，这条路径是插件对外的安全边界。
- `package.json`：`files` 白名单决定 npm 包内容，新增文件若要随包发布需同步加入；`dsh.compatibility` 的宿主版本表由维护者实测后追加，请勿在 PR 中填写未验证的版本。
- 文档：`README.md` 与 `README.en.md` 同步修改，只改一份需要补充另一份。
- 不要提交 `AGENTS.md`、`temp-*`、`node_modules/`、`.npm-cache/`，`.gitignore` 已覆盖这些路径。

## 测试

`smoke/smoke-test.cjs` 是离线状态机测试，覆盖三代宿主结构、主开关、中英文案、快捷裁决桥、闲置判定与通知标签长度。新增判定分支、配置项或文案时，请补对应用例，否则行为回归只能靠人工发现。`smoke/cordis-host-test.mjs` 在找不到本机 DSH 时跳过，属于正常情况。

## 署名与致谢

外部 PR 由维护者改写后提交：不沿用原 commit、不加 `Co-authored-by`，贡献者记入 README 的「致谢与贡献须知」表格。致谢只在 README 维护：`CHANGELOG` 与 Release 说明只记录行为与文档变化，不重复列致谢名单。提交身份由维护者在落地时统一处理，PR 中不必为此调整。

## 安全问题

请按 [SECURITY.md](SECURITY.md) 的私密渠道报告，不要开公开 issue 或 PR。
