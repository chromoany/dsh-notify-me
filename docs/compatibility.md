# 兼容性

逐版本适配记录见 [package.json](../package.json) 的 `dsh.compatibility.dshReleases`；宿主（`0.2.1-rc.2` 及之后）的安装门控只读 `peerDependencies` 与 `engines`，**不再读取这个字段**，所以它只是一份给人看的记录，不构成门禁。

已逐版实测**真正激活**于 `0.1.1-rc.2`、`0.1.2-rc.1`、`0.1.5-rc.1`、`0.1.5-rc.2`、`0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.3`、`0.2.1-rc.4`、`0.2.1-rc.5`、`0.2.2-alpha.2` 与 `0.2.2-rc.1`（判定标准：插件条目进启动页 `__DSH_BOOT__`、注入依赖解析通过、`/plugins/??dsh-notify-me/client.js&rev=…` 返回含新代码的构建、设置里出现「通知提醒」分区）。`0.1.1-rc.2` 到 `0.2.2-rc.1` 的插件条目照旧兼容，换回旧宿主也不需要改配置；`1.9.0` 的界面重排没有引入新的宿主 API，设置页页眉的铃铛是插件自己画的 SVG（`docs/brand/`）。

<details>
<summary>展开宿主代际的形状差异与两个已知坑</summary>

插件按宿主代际自动选源；下表是各形状的边界，不是门禁：

| 宿主代际 | 「需要你」交互来源 | 判断当前会话 | 点通知切会话 |
| --- | --- | --- | --- |
| `≤ 0.1.2-alpha.1` | 控制器快照的 `pending[]` | 快照 `current` | `sessions.open()` |
| `0.1.2-alpha.2 .. 0.1.6-alpha.1` | `uiSession.pendingInteractions` | 快照 `current` | `sessions.open()` |
| `≥ 0.1.6-alpha.2`（含 `0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.5`、`0.2.2-alpha.2`、`0.2.2-rc.1`） | `uiSession.sessionStatus` | `retainedBy.mainView` | `uiWorkspace.openSession()` |

区间仅作示意：插件按 store 形状自动选源（`sessionStatus` 存在即走新路），版本号只是各形状的出现边界。`peerDependencies` 范围决定 npm 的 peer 提示——`0.2.1-rc.2`、`0.2.2-alpha.2` 与 `0.2.2-rc.1` 都落在 `>=0.2.0-rc.1 <0.3.0-0` 里，不需要豁免。

`0.2.1-rc.3`、`0.2.1-rc.4`、`0.2.1-rc.5`、`0.2.2-alpha.2` 与 `0.2.2-rc.1` 各跑了一轮隔离验证：隔离 `DSH_HOME` 装好插件再起 `dsh web --no-open`（`rc.3` / `rc.4` / `rc.5` 都是 71 个启动条目，`0.2.2-alpha.2` 72 个，`0.2.2-rc.1` 74 个），插件条目 `dsh-notify-me` 都在 `application` 批（`0.2.2-rc.1` 把启动载荷改成 entries + batches、按批合并加载，插件条目本身没变），三个注入目标（`client-ui-session`、`client-locale`、`client-ui-conversation`）都在；`/plugins/??dsh-notify-me/client.js` 返回当时的构建（`rc.3` / `rc.4` 是 1.16.1 的 248,023 B，`rc.5` 是 1.17.0 的 252,562 B；`0.2.2-rc.1` 返回的就是仓库里 1.17.0 的 `lib/client.js`，宿主只在末尾追加 70 B 的 sourceMappingURL 注释，HTTP 200）；无头 Edge 经 CDP 载入真实页面后 `apply` 正常执行，`debug()` 报 `uiSession: bound`、`uiSessionSource: sessionStatus`、`raiseChannel: window-focus`（`0.2.2-rc.1` 另核了 `version: 1.17.0` 与 `notifyTagLimit: 64`；页面刚开、还没打开会话时 `uiSession` 是 `unbound`，点开一个新会话后约 1.5 秒转为 `bound`，是插件惰性查找服务的正常时序），从账号菜单进设置点开「通知提醒」能渲染出整块设置视图（`0.2.2-rc.1` 还显示「插件版本：dsh-notify-me v1.17.0」，通用设置里宿主版本为 `0.2.2-rc.1`），Web 宿主全程没有 warning/error（唯一一条 404 是桌面 Electron 页面桥 `/__dsh-notify-me/host-bridge` 的可选探测，插件自己把 `hostBridge.state` 标成 `unavailable`，不影响提醒）。四版的宿主客户端 bundle 相对 `0.2.1-rc.2` 都有改动（`dsh-client-ui-workspace`、`dsh-client-ui-conversation`、`dsh-client-locale` 等），但本插件用到的四个会话行槽位、`uiSession.sessionStatus`、`retainedBy.mainView`、`uiWorkspace.openSession()` 一个没少；`0.2.2-alpha.2` 另加了 `sidebar.session.row.trailing`，与本插件无关；`0.2.2-rc.1` 又改了 `dsh-client-ui-session`、`dsh-client-ui-workspace`、`dsh-client-ui-conversation`、`dsh-client-locale`、`dsh-client-modules` 与 `dsh-client-ui-approval` 的客户端 bundle，这些面仍然都在。`0.2.1-rc.5` 的桌面壳 `lib/main.js` 仍是通用转发（没有按路由做白名单），Windows 抬窗那条插件 exact 路由不受影响；`0.2.2-rc.1` 的桌面壳同样通用转发、仍不注册 Service Worker，并在安装版桌面（Windows）上实测了该路由：GET 200，坏 `Host` / 跨源 / 错误方法分别 403 / 403 / 405，POST 真的把窗口抬到前台。宿主侧形状仍与 `0.2.0-rc.2` 一致，不需要改代码。

两个坑值得记住：一是 `dsh.client.inject` 里列了新版运行时已不再提供的包，客户端条目会停在 `pending (waiting for services: …)` 而永不执行——1.1.3 在 `0.1.2-rc.1` 及以后正是这样失效的；二是宿主换存储或字段名时**不会报错**，提醒只会静默失效——`pendingInteractions`→`sessionStatus`、`list.current`→`retainedBy.mainView`、`sessions.open()`→`uiWorkspace.openSession()` 都是这一类，所以每次适配都要用 `window.__dshNotifyMe.debug()` 确认真的是 `bound`。

</details>

---

[← 返回 README](../README.md)
