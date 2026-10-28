# 兼容性

逐版本适配记录见 [package.json](../package.json) 的 `dsh.compatibility.dshReleases`；宿主（`0.2.1-rc.2` 及之后）的安装门控只读 `peerDependencies` 与 `engines`，**不再读取这个字段**，所以它只是一份给人看的记录，不构成门禁。

已逐版实测**真正激活**于 `0.1.1-rc.2`、`0.1.2-rc.1`、`0.1.5-rc.1`、`0.1.5-rc.2`、`0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.3`、`0.2.1-rc.4` 与 `0.2.2-alpha.2`（判定标准：插件条目进启动页 `__DSH_BOOT__`、注入依赖解析通过、`/plugins/??dsh-notify-me/client.js&rev=…` 返回含新代码的构建、设置里出现「通知提醒」分区）。`0.1.1-rc.2` 到 `0.2.2-alpha.2` 的插件条目照旧兼容，换回旧宿主也不需要改配置；`1.9.0` 的界面重排没有引入新的宿主 API，设置页页眉的铃铛是插件自己画的 SVG（`docs/brand/`）。

<details>
<summary>展开宿主代际的形状差异与两个已知坑</summary>

插件按宿主代际自动选源；下表是各形状的边界，不是门禁：

| 宿主代际 | 「需要你」交互来源 | 判断当前会话 | 点通知切会话 |
| --- | --- | --- | --- |
| `≤ 0.1.2-alpha.1` | 控制器快照的 `pending[]` | 快照 `current` | `sessions.open()` |
| `0.1.2-alpha.2 .. 0.1.6-alpha.1` | `uiSession.pendingInteractions` | 快照 `current` | `sessions.open()` |
| `≥ 0.1.6-alpha.2`（含 `0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.2-alpha.2`） | `uiSession.sessionStatus` | `retainedBy.mainView` | `uiWorkspace.openSession()` |

区间仅作示意：插件按 store 形状自动选源（`sessionStatus` 存在即走新路），版本号只是各形状的出现边界。`peerDependencies` 范围决定 npm 的 peer 提示——`0.2.1-rc.2` 与 `0.2.2-alpha.2` 都落在 `>=0.2.0-rc.1 <0.3.0-0` 里，不需要豁免。

`0.2.1-rc.3`、`0.2.1-rc.4` 与 `0.2.2-alpha.2` 各跑了一轮隔离验证：隔离 `DSH_HOME` 装好插件再起 `dsh web --no-open`（`rc.3` / `rc.4` 71 个启动条目，`0.2.2-alpha.2` 72 个），插件条目 `dsh-notify-me` 都在 `application` 批，三个注入目标（`client-ui-session`、`client-locale`、`client-ui-conversation`）都在；`/plugins/??dsh-notify-me/client.js` 返回 1.16.1 的构建（248,023 B）；无头 Edge 经 CDP 载入真实页面后 `apply` 正常执行，`debug()` 报 `uiSession: bound`、`uiSessionSource: sessionStatus`、`raiseChannel: window-focus`，从账号菜单进设置点开「通知提醒」能渲染出整块设置视图。三版的宿主客户端 bundle 相对 `0.2.1-rc.2` 都有改动（`dsh-client-ui-workspace`、`dsh-client-ui-conversation`、`dsh-client-locale` 等），但本插件用到的四个会话行槽位、`uiSession.sessionStatus`、`retainedBy.mainView`、`uiWorkspace.openSession()` 一个没少；`0.2.2-alpha.2` 另加了 `sidebar.session.row.trailing`，与本插件无关。宿主侧形状仍与 `0.2.0-rc.2` 一致，不需要改代码。

两个坑值得记住：一是 `dsh.client.inject` 里列了新版运行时已不再提供的包，客户端条目会停在 `pending (waiting for services: …)` 而永不执行——1.1.3 在 `0.1.2-rc.1` 及以后正是这样失效的；二是宿主换存储或字段名时**不会报错**，提醒只会静默失效——`pendingInteractions`→`sessionStatus`、`list.current`→`retainedBy.mainView`、`sessions.open()`→`uiWorkspace.openSession()` 都是这一类，所以每次适配都要用 `window.__dshNotifyMe.debug()` 确认真的是 `bound`。

</details>

---

[← 返回 README](../README.md)
