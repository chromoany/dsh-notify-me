# Changelog

All notable changes to **dsh-notify-me** are documented here.

## [1.16.1] — 2026-10-28

文案修正，无行为变化。

### 文档

- 设置页「会话静音」卡的说明原写「被静音的会话在标题前显示划掉的铃铛」，但那个槽位在会话有运行状态时被状态点占用——正在跑的后台任务看不到标记。说明里补上这一点，并指出此时看行尾铃铛的按下状态（中英同步）。`README.md` / `README.en.md` 的正文本来就写了这个限制，只有设置页漏了。
- 同一段里「列表上限 500 条」改成 200 条：上一版把 `MUTED_MAX` 降到 200（心跳 body 的 16 KiB 上限），README 两处漏改（`README.md:158`、`README.en.md:158`）。
- README 中英：兼容性写清实测范围——徽章与「已逐版实测真正激活」名单从 `0.2.1-rc.2` 更新到 `0.2.2-alpha.2`，补上 `0.2.1-rc.3` / `0.2.1-rc.4` / `0.2.2-alpha.2` 三版隔离实测（启动条目 71 / 71 / 72、`client.js` 返回 1.16.1 构建 248,023 B、`apply` 执行且 `debug()` 报 `bound`、设置页渲染出整块「通知提醒」）与「四个会话行槽位一个没少」的结论；`dsh.compatibility.dshReleases` 同步补 rc.3 / rc.4。
- 设置页截图重拍：旧图是 1.14.1 时代拍的（页脚版本号与「会话静音」卡片都不对），改在 `0.2.2-alpha.2` 的隔离实例里过 CDP 截取，两张 alt 文本补「会话静音 / muted sessions」。

## [1.16.0] — 2026-10-28

回应 [#23](https://github.com/chromoany/dsh-notify-me/issues/23)：可以按对话静音，只影响那一行。

### 新增

- **按对话静音**：会话行悬停时右侧多一个铃铛——点一下静音这条对话，再点恢复（`静音此会话` / `取消静音`）。闸门在 `fire()` 与列表判定同一处短路：本地通知、提示音、标签页标记、外部推送全部不发，别的对话不受影响；测试按钮不受影响（它直接走 `deliver()`，本来就是「我现在就要看一条」）。列表存在本地配置 `mutedSessions` 里，重载与重启后仍在，`readConfig` 会把手工改坏的内容（非字符串、空白、超长、重复）过滤掉而不是整页挂掉。
- **静音标记**：被静音的对话在标题前带一个划掉的铃铛（`role="img"` + `aria-label`，读屏能读出来）。它注在 `sidebar.session.row.leading` 槽位，而宿主在这一槽位被「会话有运行状态」的状态点占用时**不渲染**——正在跑的后台任务看不到标记，停下后回来。这是宿主槽位的既有语义，不是本插件能改的。
- **设置页「会话静音」卡片**：列出现有静音对话的数量，一键全部恢复（`恢复全部`）；空列表时说明「没有静音的对话」。中英文案与读屏标签同时补齐。
- **宿主兜底跟着静音**（`lib/host-fallback.js`）：心跳 body 从 `{alive, language}` 扩成 `{alive, language, muted}`，宿主记住这份列表并按会话 id 跳过——否则关掉标签页后，页面明明关掉了提醒，宿主兜底却照发一遍。心跳里只认数组，非数组、超长、重复项在 `createPresence` 侧归一（上限 200 条、单 id 200 字符），页面在发之前再按 8 KiB 字节预算截一段——心跳 body 的宿主上限是 16 KiB，压过线会回 `413`、租约断掉，兜底于是误以为页面关了；被截掉的会话仍在本页静音，只是不由兜底接管。标题仍然照记忆，取消静音后不会变成无名的会话。

### 测试

- `smoke/smoke-test.cjs` 新增两组：`mutedSessionsHonoured`（未静音基线照发并外发一次 → 静音后既不弹也不外发 → 邻居对话不受影响 → 取消静音后恢复 → 存过的静音重载后仍生效 → 手改的垃圾列表被剪成 `["a","b"]`）、`mutedSessionsUi`（两槽位各自注册、未静音时铃铛为 `静音此会话` 且标记为 `null`、点击静音后状态翻转且阻止冒泡、设置卡片计数与一键恢复、空状态文案）；心跳 body 的形状断言同步改成三个字段，并加「静音变化立刻补一次心跳」的用例。
- `smoke/page-bridge-test.mjs`：心跳带 `muted` 时仍 `200` 且租约正常；非数组被忽略、900 条的列表归一后仍 `200`，都不让心跳失败。
- `smoke/smoke-test.cjs` 另断言心跳本身不会超线：塞满 200 条 200 字符的静音列表后，仍按 8 KiB 预算截成前缀子集发出（防止「配了静音却因为 `413` 收到兜底提醒」）。
- `smoke/host-fallback-test.mjs`：页面报告静音后，`turn/end` 与 `approval/asked` 都不投递；未静音的邻居照发；心跳取消静音后下一条正常送达。

## [1.15.0] — 2026-10-28

收编 [#25](https://github.com/chromoany/dsh-notify-me/pull/25)（回应 [#24](https://github.com/chromoany/dsh-notify-me/issues/24)）；两项宿主侧能力默认关，未配置时行为与上一版一致。

### 修复

- **指向网关的直连目标自动改走同源中继**（本轮报障的直接原因）：页面的「自定义」目标如果填的正是宿主中继的上游网关地址，浏览器永远拿不到可读回执——Basic 认证让请求变成预检，而网关回预检时没有 `Access-Control-Allow-*`；转 opaque `no-cors` 兜底又成了**跨站** POST，Apprise 直接回 `403 Cross-site request rejected`。旧版把这种结局记成 `unverified`，设置页于是显示「上次已送出（不可确认）」、测试按钮报「已送出不可确认 1 · 失败 0」，**而消息根本没投出去**。现在这类目标在发送时折叠到同源中继路由（相对路径 → 同源、无预检、无跨站拒绝；凭据由宿主补上，回执是网关真实状态），状态变成「上次成功」。折叠要同时满足 `type: custom`、URL 的主机名与路径都等于中继上游那条地址、目标没有配签名密钥、且目标不是本页同源，差一项就原样直发：别的网关（Discord / Bark / 别的自建中转）本来就不是这条中继能送到的，而同一个网关上不同的 notify key 靠路径区分，只比主机名会把 A key 的提醒发到 B key，配了签名密钥的目标折叠过去则丢了签名。
- **「未确认」不再读起来像成功**：`unverified` 的文案改为「上次已发出（未确认送达）」（英文 `last delivery unconfirmable`），并把原因一并写进健康记录（`opaque` → 跨域端点读不到回执，是否送达无法确认；`via-relay` → 经同源中继）。旧版只给失败写原因，所以页面在真正失败时也只说「已送出」，用户没有任何线索可查。测试按钮的计数同步改成「未确认送达」。

### 安全加固

- **折叠必须命中同一条网关地址**：主机名与路径都要等于中继上游，且目标没有配签名密钥、目标也不是本页同源（详见上面「修复」第一条）。旧写法只比主机名，等于把一个网关上 A key 的提醒悄悄发到 B key。
- **中继 `POST` 要求 `x-dsh-notify-me-relay: relay` 意图头**：没有它，任何能猜到路径的页面（含跨站 `no-cors` 表单、不带预检的简单请求）都能把宿主当免费推送器；带自定义头必然触发预检，而这条部署的预检必然失败。探针与 `POST` 仍各自过同一道闸门。
- **上游回执限量读取**：`upstreamBody` 只取前 500 字符（对外口径不变），但底层读取改成 64 KiB 上限的受控读取——旧写法用 `res.text()` 整段读进内存，一个异常或恶意的网关可以让宿主无限读下去。
- **读客户端 body 时客户端中途挂断也能落定**：以前只等 `end` / `error`，直接断连的请求会让 Promise 永不结算、句柄挂着不还；现在 `close` 同样落定。
- **凭据读取失败只记路径与错误码**，不打完整错误对象（里面常带绝对路径与系统调用细节）。
- **页面桥接的生命周期补齐**：探测定时器与三个监听器都进了 `unsubs`，禁用插件或热重载后租约立刻释放、心跳停掉；旧写法在页面已卸载后仍每 60 秒拿回租约，宿主兜底被静默关掉而设置页显示「已启用」。
- **能力状态如实回报**：`host-bridge` 回的 `hostFallback.enabled` / `relay.enabled` 现在是「能不能真跑」而不是「配置里写没写」——缺网关、缺绝对路径时为 `false`，`features` 同步。旧写法会让页面握着永远等不到的租约，或者往根本没挂载的中继路由发提醒、把网关的沉默记成一次「拒绝」。

### 新增

- **`host-bridge` 公布中继的上游端点**（`relay.upstreamHost` / `relay.upstreamPath`，只发布主机名与路径，不含凭据与路径 token）：页面靠它们判断某个直连目标是不是「中继自己的那个网关端点」——只比主机名会在一个网关挂着多个 notify key 时发错。`debug().hostBridge` 同步暴露 `relayUpstreamHost` / `relayUpstreamPath`；设置页会在会被折叠的目标下显示一行说明，免得用户以为那个地址在浏览器里本来就能用。

- **页面关闭后的宿主侧兜底**（`lib/host-fallback.js`，默认关）：订阅宿主的 `session/event`，页面不在时继续把「审批请求」「回复完成」发往配置的网关——**文案与页面通知逐字一致**（标题 `<前缀> · 审批请求` / `<前缀> · 回复完成`；正文「回复完成」只有会话名、审批是 `会话名：工具名 · 原因`），不含任何用户消息正文，因此不会把注入的 `<system-reminder>` / 记忆上下文 / 时间戳带进通知。审批按 id 去重（每会话缓存上限 500）、`turn/end` 每会话按 `turnEndThrottleMs`（默认 15000 ms）节流（只管 `completed`，`aborted` / `error` / `max-tokens` 这些收尾不节流：它们本来就少，而且往往是最该看到的那一条）、子代理会话默认跳过、`language: 'auto'` 时跟随页面心跳报告的语言；`turn/end` 的 `reason` 按对象 `{kind}` 读取，`completed` 之外的收尾会把 kind 附在正文；`session/disposed` 用独立事件清缓存（它不是会话日志项）。
- **同源中继**（`lib/relay.js`，默认关）：`<relay.path>` 上 `GET` / `HEAD` 是只读探针，`POST` 把页面载荷映射为网关的 `{title, body, type:'info'}`（不透传 `tag`——Apprise 把未匹配的 tag 当 424）、由宿主补上凭据与 `gateway.headers` 转发，回 `200 {ok, upstreamStatus, upstreamBody}`（`upstreamBody` 上限 500 字符）；上游非 2xx 回 `502`，凭据文件配了但读不出来回 `503`，上游异常或网关回 3xx 回 `502 {reason:'upstream-error'}`（跳转不跟：跟过去会把 body 和 `Authorization` 重放到别处）；`POST` 必须带 `x-dsh-notify-me-relay: relay` 意图头，缺了回 `403 {reason:'missing-intent'}`（跨站表单发不出自定义头，要发就得多一次预检，而预检在网关这里必然失败）。启用需要绝对路径与可达的 `relay.target`，否则不注册路由，只在日志里留一行 warning，状态回包也如实报「未启用」。
- **页面在线租约**（`lib/page-bridge.js` 的 `createPresence`）：页面 `GET` 探测 `/__dsh-notify-me/host-bridge`，只在 `hostFallback.enabled` 为真时心跳（间隔 `leaseMs/3`，夹在 5–20 秒），`pagehide` 发 `{alive:false}` 立刻释放；租约默认 60000 ms，`pageLeaseMs: 0` 关闭协调（页面开着也会重复，仅调试用）。心跳 body 只承载 `{alive, language}`：语言让宿主文案跟着页面走，页面自己的推送开关与可见性判定不进宿主（规则是「没有页面持有租约时宿主接手」，只照做一半会得到谁也算不清的规则）。
- **共享请求闸门泛化**（`lib/page-bridge.js` 的 `gateRequest`）：从抬窗路由迁出并新增「由 `allowedOrigins` 派生的公网 `Host`」一档，供隧道 / 反代下的页面入口使用；不传 `allowedOrigins` 的抬窗路由行为与旧版一致。同源判定按连接的实际协议与端口补齐默认值（`Host` 里不写端口时，`https` 按 443、`http` 按 80 与 `Origin` 比较，反代下的 `Host: example.com` 配 `Origin: https://example.com` 不再被误判 `cross-origin`）。宿主兜底与中继的宿主入口不再各自实现一份闸门。
- **凭据读取器**（宿主内）：0600 JSON 支持 `{user, password}`（HTTP Basic）与 `{authorization}`（原样发送；裸 token 补 `Bearer `）；未配置凭据文件时请求不带认证头（多数 webhook 端点本就不需要认证），只有「配了路径但读不出来」才算凭据不可用；缓存只在宿主进程内，网关回 401 / 403 时丢缓存重读文件、只重试一次，所以轮换密码不需要重启宿主；读失败时日志只写「哪个路径读不出来」与错误码，不打错误对象（里面常带完整路径与系统调用细节）。
- 设置页「高级设置 → 外部推送」新增两行只读状态：「宿主侧兜底」（已启用 · 页面关闭后仍会推送 / 未启用 / 宿主未响应）与「同源中继」（已启用 + 可复制的 `location.origin` + `relay.path`）。`debug()` 新增 `hostBridge: {state, leaseMs, relayEnabled, relayPath, relayUpstreamHost, relayUpstreamPath, lastReason, lastProbeAt, lastBeaconAt}`（`lastReason` 只在上一次探测失败时带值，如 `bad-host` / `cross-origin` / `http-403`）。中英文案同时补齐（`TXT.zh` / `TXT.en` 与 `UI_zh` / `UI_en`）。

### 测试

- 新增 `smoke/page-bridge-test.mjs`（状态回包形状、心跳与释放、缺意图头 `403`、跨源 `403`、坏 JSON `400`、超长 `413`、`allowedOrigins` 派生 `Host` 放行、路径冲突、同源判定的端口默认值（`https` / `http` 隐式端口、`Host` 不带端口）、缺失网关时兜底与中继都不报「已启用」）、`smoke/host-fallback-test.mjs`（审批去重、`turn/end` 节流且只节流 `completed`、子代理跳过、租约新鲜时不发、租约过期后发、`alive:false` 后立刻发、语言跟随心跳、401 重读凭据、健康探针）、`smoke/relay-route-test.mjs`（`GET` 探针、`405`、跨源 `403`、缺意图头 `403` 且不碰上游、`413`、`400`、`503`、`200` / `502` 映射、401 只重试一次）。
- `smoke/smoke-test.cjs` 补页面侧用例：探测回「已启用」时发出心跳且语言正确、404 时不心跳、`pagehide` 发 `alive:false` 并停心跳、`debug().hostBridge` 字段形状（含 `relayUpstreamHost` / `relayUpstreamPath`）。
- `smoke/smoke-test.cjs` 补中继折叠用例：指向中继上游网关的 `custom` 目标被改写到中继路径、请求带 `x-dsh-notify-me-relay: relay` 意图头、状态为 `sent`、载荷仍带标题与正文且不是 opaque 请求；路径相同但主机不同、主机相同但路径不同（同一网关的另一个 key）、以及配了签名密钥的目标都不被改写；中继关闭时目标直发并落到 `unverified` + `reason:'opaque'`（变异测试确认这些断言会失败）。
- `npm test` 串上三个新套件（顺序：smoke-test → host-route → page-bridge → host-fallback → relay-route → cordis-host）；三个新套件自带假 `ctx`，不依赖本机 DSH、不联网。`package.json` 的 `files` 增加三个新模块。

### 文档

- README 中英：顶部特性与运行前提改成准确口径（本地通知仍要页面在；开启宿主兜底后外部推送由宿主接着发）；「高级设置」新增「页面关闭后：宿主侧兜底与同源中继」小节（可粘贴的 profile 覆盖示例、逐键默认值、0600 凭据文件、租约去重语义、健康探针、中继的三条 CORS 事实与 `200` / `502` / `503` / `400` / `405` / `413` 口径、`allowedOrigins` 与隧道 / 反代的 `Host` 闸门）；中继 `POST` 补意图头与 3xx 不跟随的说明，折叠条件补「主机名 + 路径都要一致、带签名密钥不折叠、同源不折叠」，节流口径补「只管 `completed`」，`host-bridge` 回包补 `upstreamHost` / `upstreamPath`，`debug()` 补 `relayUpstreamHost` / `relayUpstreamPath`；提醒渠道表补两行；已知限制补运行前提与仍然成立的边界（宿主进程需在运行、代理环境要配 `no_proxy`）；开发自检补三个 smoke 套件。
- SECURITY 中英：数据处理范围补宿主兜底与同源中继（同样的会话名 / 审批文本由宿主发往你自己的网关、凭据只在宿主 0600 文件、中继路径等同口令、闸门新增 `allowedOrigins` 派生 `Host` 一档）；把「路径只对能过闸门的调用方可见、随机性挡猜路径而闸门挡不速之客」与折叠的同源性判据写进威胁模型，受理范围补中继能力路径被绕过与租约协调缺陷。

## [1.14.7] — 2026-10-27

### 修复

- **「恢复默认设置」写不进去时也会说了**：`resetConfig()` 以前把 `localStorage.removeItem` 的失败吞掉，设置页照样提示「已恢复默认设置」，刷新之后旧配置又回来。现在它和保存走同一条 `configWriteFailed`，`debug().configStored` 为假、页面上写明「设置没能保存」。

### 文档

- README 中英：提醒渠道补上 Linux；外部推送写明关掉转发会取消已排队的重试、服务码非成功值记失败、2xx 但不是该服务的 JSON 记「已送出不可确认」；控制台示例补 `hostEnv` 与 `debug()` 的 `raiseChannel` / `raiseLast` / `configStored`。
- README 致谢表补 [#21](https://github.com/chromoany/dsh-notify-me/issues/21) / [#22](https://github.com/chromoany/dsh-notify-me/pull/22)：Linux 上 `dsh://open` 抬窗失效的报障与补丁。11 张贡献者头像统一成同一套 48×48 圆形遮罩（此前有的方形、有的自带 alpha）。
- `docs/listing.md` 版本口径同步到 1.14.7。

### 测试

- `storageFailureFeedback()` 现在也覆盖写失败后的 `resetConfig()`：`configStored` 仍为假，提示行还在。

## [1.14.6] — 2026-10-27

### 修复

- **监听器只绑一个具体局域网 IP 时，桌面端点通知不再抬不起窗**：抬窗路由的闸门只认 loopback 对端与 `Host`，而 `webServer` 可以被配置成只绑一块网卡；那种情况下壳按绑定地址拨号，请求的对端和 `Host` 都是那个 IP，被 `403 bad-remote` / `bad-host` 挡掉。现在闸门额外接受「恰好是监听器自己绑定的那个 IP」（`webServer.host`）作对端与 `Host`；局域网里别的机器连过来源地址不是这个 IP，照旧拒绝。
- **会话基线不再随子代理会话一直涨**：`prevById` 在会话首次出现时新增，消失后永远保留。长开的页面上子代理会话来来去去，`debug().sessionBaselines` 只增不减。现在连续 40 次列表更新都缺席的行会丢掉基线（顺带清掉 `doneFiredAt`）；短暂消失仍保留，不影响「消失再出现不补报」的语义。

### 测试

- `host-route-test.mjs` 用 `webServer.host = 192.168.1.5` 的假宿主补了四条：本机自拨的绑定地址放行、局域网别处的客户端 `bad-remote`、自拨但 `Host` 是别的域名 `bad-host`、跨源 `Origin` 照旧拒绝。
- 冒烟新增 `vanishedBaselinesPruned()`：短暂缺席保留基线，连续 40+ 次更新后清零。

### 文档

- README / SECURITY 中英的闸门说明补上「或监听器自己绑定的那个 IP」。
- `docs/listing.md` 版本口径同步到 1.14.6。

## [1.14.5] — 2026-10-27

### 修复

- **外部推送关掉后重试还会继续**：重试链挂在定时器上，旧代码不再复查总开关、也不复查目标还在不在，关掉转发后浏览器仍会往那个地址继续 POST，还把取消掉的投递记成失败。现在每次尝试前复查开关与目标列表，取消的投递不计失败、不写死信；测试按钮仍然照发。
- **服务码终于在页面侧生效**：`postOnce()` 读的是 `spec.type`，可 `spec` 只是请求体、目标类型在它外面，于是 `externalVerdict()` 的服务码分支（飞书 / Server酱 / WxPusher）从来没跑过，2xx 一律记「已发送」——飞书 token 错了也一样。现在类型正确传入：服务返回 `code != 0`（WxPusher 是 `1000`）记失败并带服务端文案；2xx 但 body 不是该服务的 JSON（空白、代理或 WAF 的网页）记「已送出不可确认」，不再冒充成功。
- **配置写不进去时页面会说了**：`localStorage.setItem` 抛错（配额、无痕模式、存储被禁）以前被空 `catch` 吞掉，开关看着已保存、刷新就还原。现在记 `configWriteFailed`，`debug().configStored` 给出真假，设置页底部写明「设置没能保存」；写入失败期间后续改动基于内存里的最新配置，不再从旧存储重建。
- **审批测试通知的按钮 6 秒后失效**：标题标记到点释放时把 `pendingActions` 记录一起删了，可测试通知还留在通知中心，此刻点「同意 / 拒绝」什么都不发生。现在标记照常释放、记录留到 12 秒后与通知一起收。
- **「从不关闭」对审批通知也作数**：没有按钮的那条路径原来 12 秒必收，选了「从不关闭」照样消失。
- **通知权限弹窗被关掉后还能再问**：`permAsked` 一旦置真就不再复位，测试按钮从此唤不起授权。现在显式点测试会重新请求一次。
- **输入监听从模块作用域移进 watchers effect**：客户端插件热重载时不再叠一套指针 / 键盘监听，dispose 能摘干净。

### 测试

- 新增 `smoke/host-route-test.mjs` 并接进 `npm test`：不依赖本机 DSH，`lib/index.js` 的 exact 路由、GET 探针、403/405/501 闸门与脚本失败路径在任何平台都会跑。`cordis-host-test.mjs` 里原来那份挪走了，不再躲在「本机没装 DSH 就跳过」后面。
- 冒烟新增：关掉转发后不再重试且不计失败、2xx 非服务 JSON 记不可确认、服务码错误记失败、写配置失败提示与内存兜底、测试通知按钮活过标题标记、权限被拒后可再次请求。

### 文档

- README 中英：审批通知到底什么时候收，按实际行为重写（带按钮的不设自动撤回，桌面端无按钮的按 12 秒收，「从不关闭」时都不收）。
- README / CONTRIBUTING 的开发自检改成跨平台写法（正斜杠、`sh` 围栏），PowerShell 那条单独标 Windows；硬刷新补上 macOS 的按键。
- SECURITY 中英：抬窗入口的鉴权口径改成实际的三条（回环对端、回环 `Host`、带 `Origin` 时须同源），并写明 PowerShell 只在 Windows。
- `docs/listing.md` 版本口径同步到 1.14.5。

## [1.14.4] — 2026-10-27

### 修复

- **非 Windows 桌面端点通知又能把窗口抬回前台了**：1.14.0 把抬窗整条换成宿主路由 + `lib/focus-window.ps1`，可这条路由只对 Windows 放行——宿主在非 `win32` 平台直接回 `501`，于是 Linux / macOS 上点通知只剩切会话，窗口留在后台（issue #21）。现在按平台分流：Windows 继续走宿主路由（深链在 `0.2.1-rc.2` 上复测 3/3 无效），其他桌面端恢复 1.5.2 到 1.13.0 的 `dsh://open` 隐藏 iframe——子框架导航绕过壳的顶层 `will-navigate`，交给系统协议注册，由壳的第二次启动处理 restore + show + focus。已在 Arch Linux + Electron 44.7（Plasma 6.8 / Wayland）上实测最小化与后台窗口都能抬回来；macOS 走同一条深链，未实测。
- **`debug().raiseChannel` 不再依赖第一次点击**：字段改成按平台直接算（Windows `host-route`、其他桌面端 `dsh-deeplink`、浏览器 `window-focus`），装完打开设置页就能看到这台机器会走哪条通道；`raiseLast` 照旧记录最近一次尝试（深链记 `deeplink`，抬没抬起来要肉眼确认，它说不了）。
- **「测试提醒」不再谎报已发送**：通知权限没给时，`showToast()` 在尝试之前就返回，设置页却照旧写「已发送测试提醒」；现在按钮直接报「通知权限还没给」。Service Worker 那条路径也一样——`showNotification()` 的拒收是异步的，旧代码同步读 `lastToastReject`，异步拒绝落地时页面早写过「已发送」了（issue #18 在唯一能带按钮的那条路径上的残余）。现在测试按钮等这个 promise 落定再报结果。
- **存储里的配置不是对象时不再让插件整个起不来**：`JSON.parse` 对 `null`、`"x"`、`7` 都照收，随后填默认值的 `in` 判断在非对象上抛错，整个客户端模块挂掉、页面一条提醒都没有。现在只认普通对象，其余一律回落默认值（`lib/client.js` 的 `readConfig()`）。

### 测试

- 冒烟在 `desktopRaiseChannel()` 里补上点击前的通道断言（Windows / macOS / Linux 三个 UA），以及 macOS 点通知只插一个 `dsh://open` 帧、不 POST 宿主路由的用例；Windows 的 `iframe` 断言文案改成「Windows 不发深链」。`npm test` 全绿（`cordis-host-test` 在本机无宿主，照旧跳过）。
- 新增 `corruptStoredConfig()`（`null` / 字符串 / 数字 / 数组四种坏配置都能启动到默认值）、`deniedPermissionFeedback()`（权限被拒时测试按钮报没权限，不再写「已发送」）、`swRefusalFeedback()`（Worker 异步拒收后反馈行是「系统拒收了这条通知」）。两处修复都做过「改回去就挂」的反向验证。

### 文档

- README 的抬窗章节改成按平台叙述，`501` 闸门的说明改成「非 Windows 宿主」，已知限制里补上非 Windows 深链的前提（系统注册 `x-scheme-handler/dsh`、壳处理第二次启动）。
- `lib/index.js` 顶部注释改成按平台表述：这条路由是 Windows 专用的，其他桌面端页面根本不发请求。
- `docs/listing.md` 版本口径同步到 1.14.4。

## [1.14.3] — 2026-10-26

### 修复

- **当前会话的通知正文改用真实会话标题**：以前关于「已经在屏幕上的那个会话」的通知，「回复完成」的正文、以及「需要你」的会话行，对当前会话第一行写死占位符「当前对话 / Current conversation」，而其他会话都带侧栏标题。现在当前会话也从同一条列表行取标题（新增 `sessionTitleOf()`，与侧栏同一个 `displayTitle`/`title`，宿主改名后下一条通知即生效）；只有列表还没给出标题的新会话（或列表里暂时没有这一行）才回落到占位符。宿主 0.1.x 与 0.2.x 共用这条 adapter，两代都修复（issue #20）。

### 测试

- 冒烟新增 `currentSessionTitle()`：当前会话的「需要你」正文以会话标题开头、不含「当前对话」；「回复完成」正文等于标题；没有标题的会话仍回落「当前对话」。`modernHost()` 里当前会话「回复完成」的断言从占位符改为列表标题。`npm test` 全绿（冒烟 + cordis 真宿主两套）。

### 文档

- `docs/listing.md` 版本口径同步到 1.14.3。

## [1.14.2] — 2026-10-24

### 修复

- **桌面端「测试「审批按钮」」不再无声失败**：Windows 拒收 tag 超过 64 字符的通知，而 Chromium 交给平台的最终 tag 是 `n#<origin>#<tag>`——`dsh-app://app` 先占 16 字符。旧测试 key 是 `test:approval:<13 位毫秒>`，tag 51 字符、整条 67，`new Notification()` 构造时直接抛 `The size of the notification tag is too large`，异常被 `showToast()` 的空 catch 吞掉，设置页却已经写了「已发送」（issue #18）。现在所有 tag 统一走 `toastTag()`：按 `location.origin` 算出平台前缀的占位，超长时保留可读前缀、尾部换 FNV-1a base36 哈希收口；审批 tag 仍由 `closeNotificationTag()` 用记录里的同一个字符串关闭。
- **测试 key 缩短**：`"t" + Date.now().toString(36)`（10 字符），tag 33 字符，离桌面端 48 的天花板有余量。
- **拒收不再静默**：`showToast()` 的 catch 与 Service Worker `showNotification()` 的异步 reject 都记一条 `lastToastReject`（tag 长度 + 平台原文），写进 `debug()`；设置页测试按钮命中拒收时改报「系统拒收了这条通知：<原因>」，`window.__dshNotifyMe.test()` 的返回串带上 `refused=`。

### 测试

- 冒烟新增 `toastTagLimits()`：桌面 origin（`dsh-app://app`）下 budget 为 48、审批测试 tag ≤ 48 且不再含 51 字符的旧 key；100 字符的交互 key 被哈希收口、仍以 `dsh-notify-me-attention-` 开头、两个不同长 key 收口后不撞；28 字符的 Web origin 把 budget 压到 33 并让同一条审批 tag 跟着缩短；`Notification` 构造抛错时 `debug().lastToastReject` 记下平台原文与 tag 长度，`api.test()` 报 `refused=`。`npm test` 全绿。

### 文档

- `docs/listing.md` 版本口径同步到 1.14.2。

## [1.14.1] — 2026-10-23

### 修复

- **抬窗路由的 CSRF 闸门换成本地性校验**：1.14.0 把 `x-dsh-notify-me-focus: focus` 头当成防线，理由写的是「跨源页面带这个头要先过预检」。这条对 DNS rebinding 不成立——rebinding 出来的页面和目标地址同源，能带任意自定义头、不会触发预检。现在改成三层：对端地址必须 loopback；`Host` 必须是 loopback 名（`127.0.0.1` / `localhost` / `[::1]`，可带端口）；带了 `Origin` 就必须与 `Host` 同源。任一条不满足回 `403`，`reason` 写 `bad-remote` / `bad-host` / `cross-origin`。
- **`Host` 这一层是真正的分界**：壳转发 `dsh-app://app` 时会把 `host` 一起删掉，由 fetch 按 loopback URL 重填，所以桌面页面永远带 loopback 的 `Host`；rebinding 的页面 Host 仍是攻击者域名。自定义头保留，但只当「这是页面发的」标记，不再承担安全职责。
- **`OPTIONS` 一律 `405` 且从不回 CORS 头**：预检不会被应答，跨源页面拿不到放行。

### 测试

- cordis 冒烟的路由段补五组断言：外边 `Host` → `403 bad-host`；非 loopback 对端 → `403 bad-remote`；跨源 `Origin` → `403 cross-origin`；同源 `Origin` 通过闸门后走到 `501`；换端口的 `Origin` 也算跨源；预检 `OPTIONS` → `405`。假请求补齐 `socket.remoteAddress` 与默认 `Host`。
- 另用真 socket 复现过 1.14.0 的行为：`POST` 带 `Host: evil.example` + 跨源 `Origin` 仍返回 `200 focused:true`（打进 OS 激活路径），硬化后同样请求回 `403 bad-host`。`npm test` 全绿。

### 文档

- 中英 README 与 `docs/listing.md` 的安全段改口径：不再说「自定义头挡跨源」，改成本地性三层闸门与各自的 `reason`。

## [1.14.0] — 2026-10-23

### 新增

- **桌面端点通知真的能抬窗了**：插件在宿主侧注册一条 exact 路由 `POST /__dsh-notify-me/focus-window`，页面点通知时 POST 过去，宿主 spawn 一次 `powershell.exe` 跑 `lib/focus-window.ps1`，按 pid 找到 Electron 主窗口后做原生激活，把 `FOCUSED=1|0` 回成 `200` / `202`。此前那条 `dsh://open` 深链在 0.2.1-rc.2 上隔离复测 3/3 无效，1.14.0 起整条删掉。
- **`debug()` 多一个 `raiseLast`**：`focused` / `not-focused:<原因>` / `http-<状态码>` / `error` / `browser` / `no-fetch`，报障时能分清是「路由没到」「脚本没抬起来」还是「浏览器里本来就只有 `window.focus()`」。`raiseChannel` 现在桌面端是 `host-route`，浏览器端仍是 `window-focus`。
- **路由自带三条自证**：`GET` 返回 `{ok, route, enabled, desktop, platform}`，装机后可以先用浏览器打开确认路由在不在；非桌面宿主（Web 版、macOS / Linux 桌面、纯 Node）一律 `501 unsupported-host`，不会去 spawn 一个注定失败的进程。

### 移除

- **`dsh://open` 隐藏 iframe 通道**：子框架导航绕过 `will-navigate` 那条路依旧在，但应用的单实例让位每次都先于聚焦发生（带参第二实例约 130 ms 后退出码 1，`IsIconic` 不变），留着只是白起一个进程。

### 说明

- **为什么走 PowerShell 而不是原生模块**：插件宿主是普通 Node 进程（壳以 `ELECTRON_RUN_AS_NODE=1` 拉起），拿不到 Electron API；带原生依赖还得跟宿主 ABI 对齐。`powershell.exe` 在 Windows 10/11 上必在，脚本用 `Add-Type` 现编译 P/Invoke，零安装。
- **抬窗顺序是实的，不是拍脑袋**：已在前台就什么都不做；最小化了先 `SW_RESTORE`；然后合成 ALT 抖动给本线程前台权限再 `SetForegroundWindow`；都不行才走 `SW_MINIMIZE` + `SW_RESTORE` 兜底。单独调 `SetForegroundWindow` 被前台锁拒，退到 ALT 抖动那一步就过，这也解释了此前「时灵时不灵」的观感。
- **等待上限 8 秒、400 毫秒内合并**：脚本自身最坏 0.4 秒，超时按 `FOCUSED=0` 收口并 kill 掉；连点两条通知只跑一次。
- **只 Windows**：`process.platform === "win32"` 且宿主跑在 Electron 里（`process.versions.electron`）才启用，其余平台一律 `501`，页面的抬窗行为跟以前一样。

### 测试

- 冒烟新增 6 个场景：桌面页面断言 POST 到路由、带 `x-dsh-notify-me-focus` 头、点击后切会话、`raiseLast` 为 `focused`、不再插 iframe；浏览器断点零 `fetch`、`raiseLast` 为 `browser`；`hostEnv` 两个方向都能覆盖；`501` 与 `fetch` 抛错时都只记状态、不挡切会话。
- cordis 冒烟新增路由段：真 `Context` + 假 `webServer`，断言只注册一条 exact 路由、`GET` 探测形状、非桌面 `501`、`DELETE` 405、缺 header 403，以及 `FOCUSED=1` / `FOCUSED=0` 两个桩脚本分别回 `200` / `202`。
- 真实窗口实测（`powershell.exe` 5.1，同一轮）：窗口在前台 ×3、最小化 + 记事本在前台 ×3、可见被盖住 ×3 全部 `FOCUSED=1` 且前台比对一致；记事本最大化遮挡、最小化 + 最大化遮挡、`-ProcessId 0` 自动探测同样成功；脚本内部耗时最坏 434 ms。`pwsh` 7.6 对照一轮行为一致，仅 `Add-Type` 编译慢约 100 ms。不存在的 pid 与存在但无窗口的 pid 都稳定 `FOCUSED=0` 且退出码 0。

### 文档

- README 中英重写[桌面端怎么抬窗的](README.md#桌面端怎么抬窗的)：删掉 1.5.2 深链那套叙述，换成宿主路由 + 原生激活的链路、实测数据与失败时的回退行为；已知限制里「桌面端不一定上前台」换成「提权窗口 / 虚拟桌面 / 前台被连续抢占时仍可能抬不起来，此时返回 `202` 但对话照常切」。

## [1.13.0] — 2026-10-23

### 新增

- **外部推送新增三种国内常用目标**（来自 [#17](https://github.com/chromoany/dsh-notify-me/issues/17) 的安卓端诉求）：`feishu`（飞书群机器人）、`serverchan`（Server酱 Turbo 与 Server酱³ 同一套 `…/send/<SendKey>.send` 地址 + `title`/`desp` 表单）、`wxpusher`（`appToken` + 接收者 UID，端点固定，没有可填错的 URL）。三种都走官方接口，浏览器页面能直连确认送达——飞书返回 `Access-Control-Allow-Origin: *`，Server酱与 WxPusher 回显页面 Origin。
- **失败自动重试与失败记录**：明显临时的失败（网络中断、HTTP 5xx、429）按 `externalRetryDelays`（默认 2 秒 / 6 秒，带 ±25% 抖动）退避重试；其它错误立即停。重试仍失败的投递写进「失败记录」（最多 10 条，只留标题与正文摘要、事件类型与主机名，不留完整端点），设置页可查看与清空。
- **每个目标可单独启停、并显示最近一次投递状态**：目标行右侧显示「上次成功 / 上次已送出（不可确认）/ 上次失败 + 原因 + 时间」，旁边一个独立开关（`enabled: false`）——某个端点临时不可用就单独关掉它，不必关掉整类事件。
- **出站签名**：自定义目标填了签名密钥时，请求带 `X-DSH-Notify-Signature`（对请求体做 HMAC-SHA256，`sha256=<hex>`）与 `X-DSH-Notify-Timestamp`；飞书目标填了密钥时按官方算法在请求体里带 `timestamp`（秒）/ `sign`（`base64(HMAC(key = timestamp + "\n" + secret, data = ""))`）。
- **消息模板**：飞书 / Server酱 / WxPusher / 自定义目标可填模板，占位符 `{{title}}` `{{body}}` `{{event}}` `{{time}}` `{{session}}`；留空是「标题 + 换行 + 正文」。
- 服务端返回的失败原因如实写进状态：飞书/Server酱/WxPusher 的 `code` 判成功（WxPusher 为 `1000`），失败带上 `error` / `message` / `info` / `msg`。

### 说明

- **钉钉群机器人没有做成目标类型**：实测其接口不返回任何 CORS 头，且只接受 `application/json`——浏览器页面既读不到响应，也无法在 no-cors 下发出合规请求。文档与设置页提示：自建一个中转，用「自定义 Webhook」指向它。
- **PushDeer / ntfy 同样没有做**：PushDeer 官方安卓客户端已停止维护、接口无 CORS 头；ntfy 自建在安卓上依赖常连保活、默认 `priority` 低于 4 不弹横幅。需要时仍可用自定义目标接自建 ntfy。

### 测试

- 冒烟新增：4 种目标各发一次并逐个校验报文形状（飞书 text + 签名、Server酱 form 编码、WxPusher token/uids、自定义模板与 HMAC 头）；网络错误/5xx 重试到耗尽进失败记录、4xx 不重试、第二次成功只记 `sent`；目标级 `enabled:false` 被裁剪；设置页的类型专属字段、目标启停开关、状态文案、失败记录展示与清空。

### 文档

- README 中英：外部推送整节重写（目标类型、可靠性、状态、签名、模板、钉钉为何不支持），控制台示例补 `externalRetryDelays` 与目标字段形状，已知限制口径同步；致谢表补 #17。

## [1.12.0] — 2026-10-21

### 新增

- **人走开但窗口没走也算离开**（来自 [#16](https://github.com/chromoany/dsh-notify-me/pull/16)）：`idleMinutes`（默认 3 分钟，`0` 关掉）内没有任何键鼠输入，就把「窗口在前台」按离开处理——「需要你」照常提醒、「回复完成」按离开规则提醒、`autoDismiss: "present"` 也不再撤掉那条通知。此前只认窗口失焦 / 页面隐藏，人坐在桌前离开座位时一切都还是「你在看」。
- **闲置到期会补发被压下的审批**（维护者补的）：`currentHiddenOnly` 把当前对话的等待只留标题标记时，原先只有失焦 / 页面隐藏事件才会补发；现在闲置定时器到期即补发，人离开但窗口没动也能收到。一次性触发，队列清空后不重复。
- **「回复完成」提醒时机三选一**（#16）：`donePolicy` —— `"background"`（默认，旧行为）/ `"smart"`（屏幕上那条静默，别的对话完成照常提醒）/ `"always"`（从不静默），设置页「什么时候提醒」里换成下拉。
- **通知自动消失三选一**（#16）：`autoDismiss` —— `"present"`（默认，只有你在页面时才计时关闭，离开时收到的留在通知中心）/ `"always"`（旧行为）/ `"never"`（普通通知等你点掉）。带「同意 / 拒绝」的审批通知仍按 12 秒走。

### 移除

- **页内审批卡片整条删掉**：1.11.0 删掉「浮层通道」后，桌面端还留着一张兜底卡片（`dsh-app://` 注册不了 Service Worker，审批按钮画在窗口角落）。结果是审批提醒**同时**弹系统通知和页内卡片——与「只留通知」的目标冲突，而且卡片只在窗口前台时看得见，需要提醒的时刻恰恰不在。现在 `drawOverlayCard` / `showFallbackApprovalCard` / `.dnm-ov-*` 样式 / 「审批卡片位置」设置子行 / `overlayCorner` 配置键 / `debug().card` 全部删除。桌面端的审批提醒就是普通系统通知，点通知回到对话里裁决。
- 老配置里的 `overlayCorner` 在下次读配置时删掉，其余设置不受影响。
- `window.__dshNotifyMe.debug()` 去掉 `card`；`doneHiddenOnly` 换成 `donePolicy` / `idleMinutes` / `autoDismiss` / `away`（`doneHiddenOnly` 作为读写别名保留，旧脚本仍能写）。

### 迁移

- 旧配置 `doneHiddenOnly: false` → `donePolicy: "always"`，其余 → `"background"`；写回时两者仍互相同步。
- `idleMinutes` 默认 3；写 `0` 退回只看窗口失焦 / 页面隐藏。

### 测试

- 冒烟删掉 `cardLayer` / `desktopFallbackCard`，新增 `awayWhileFocusedAndIdle`、`idleFlushesQuieted`、`donePolicyScopes`、`autoDismissPolicy`；设置页用例改为断言「审批卡片位置」子行与旧通道选项都已消失、三档下拉落盘正确、旧配置仍能加载。

### 文档

- README 中英：设置清单换成三档下拉、补闲置判定与通知自收、删「副屏与审批卡片」整节、控制台示例同步、致谢表补 #16。

## [1.11.0] — 2026-10-21

### 移除

- **「提醒方式」二选一整段删掉**：系统通知成了唯一通道，设置页不再有「通知类型」分段选择器。页面浮层当独立通道的用途是「窗口在哪块屏，卡片就在哪块屏」，可它只在 DSH 窗口处于前台时看得见——需要提醒的时刻恰恰是窗口在后台。选了浮层、切走之后，后台只剩提示音和标题标记，等于没提醒；1.10.6 想在后台补发系统通知，又违背了你选的通道。两个方向都不成立，所以直接去掉这个选项。
- `channel` / `overlay` / `toast` 三个配置键失效。旧配置里的值在下次读配置时删掉，其余设置不受影响（`overlayCorner` 保留）。
- `window.__dshNotifyMe.debug()` 里的 `channel`、`toast` 被去掉，`overlay` 改名为 `card`，只报告桌面端审批卡片（`enabled` / `corner` / `cards`）。

### 保留

- **桌面端审批卡片**：`dsh-app://` 注册不了 Service Worker，系统通知带不了「同意 / 拒绝」，所以审批类提醒仍在窗口角落画一张可点击的卡片（12 秒回收，同一条审批不叠第二张）。位置改由「提醒方式 → 审批通知上直接裁决」下面的「审批卡片位置」决定，与已删除的通道无关。
- 1.10.5 的「窗口失焦也算后台」与 1.10.7 的行为原样保留。

### 测试

- 冒烟删掉浮层通道用例（`overlayChannel`、`settingsOverlayRow`），换成 `cardLayer`（卡片只给审批、四角位置、卡片上的审批按钮能裁决）与 `settingsAlertSetup`（设置页没有通道分段选择器、审批卡片位置子行在、旧配置的 `channel` 被清掉）。

## [1.10.7] — 2026-10-21

### 撤销

- **1.10.6 的「浮层通道在后台补发系统通知」整条撤销**。它把「选浮层」变成了「浮层 + 后台时又弹系统通知」，等于绕过了用户明确选定的通道——用户的反馈是「我选的不是浮层提醒吗，为什么弹系统通知」。现在恢复 1.10.5 的行为：选了浮层就只画页面卡片，窗口被挡住时后台只有提示音和标题标记，系统通知一条都不发。想要后台可见的提醒，请把「通知类型」切到「系统通知」。

### 说明

- 1.10.5 的「窗口失焦也算后台」保留不动：它决定的是「要不要提醒」，与「用哪个通道提醒」无关。

## [1.10.5] — 2026-10-21

### 修复

- **桌面端窗口被遮住时「回复完成」不提醒**：本插件判断「你离开了」只看 `document.hidden` / `visibilityState`，而桌面壳里把 DSH 窗口切到别的应用后面、或被别的窗口盖住时，页面依然是 `visible` —— 只有最小化或整窗被遮挡才会变成 `hidden`。于是「只在后台提醒」的回复完成提醒在窗口只是被盖住时被静默丢弃（1.10.5 之前只在真正最小化时才响）。现在把窗口焦点也算进「离开」：页面失焦即视为后台，失焦瞬间同样补发此前因为「就在你眼前」而被压下的审批提醒；窗口回到前台后照常安静。设置页三个相关开关的文案同步改为「窗口在前台时也提醒」，说明里点明「切走 / 被遮挡 / 最小化」都算后台。

### 测试

- 冒烟新增 `awayWithoutHiding` 用例：焦点在时回复完成静默、失焦后同一页发出提醒、回焦再次静默、`visibilityState` 全程保持 `visible`、失焦时补发被压下的审批提醒。

## [1.10.4] — 2026-10-21

### 新增

- **桌面端审批按钮落到页内卡片**：桌面壳在 `dsh-app:` 协议下拿不到 Service Worker（注册被拒），带按钮的审批通知因此只剩标题、点不出「同意 / 拒绝」。现在这种拿不到 SW 的情形会在窗口角落画一张卡片：审批标题与正文、`同意` / `拒绝` 两个按钮、正文过长时可就地展开「详情」，12 秒自动收起，同一条审批不叠第二张卡。按钮走的是和系统通知完全同一条裁决路径（`allowed-once` / `rejected`），裁完即撤卡。Web 端（SW 可用）行为不变，仍是带按钮的系统通知。

### 修复

- 页面里写的 `api.version` 与 `package.json` 对齐（1.10.3 的发版提交只改了 `package.json`，页内版本号停在 1.10.2，冒烟断言因此一开始就是红的）。

### 测试

- 冒烟新增 12 组断言覆盖桌面降级卡片：出现时机、两个按钮、详情展开/收起、点卡片本体不撤卡、同意、拒绝、审批从状态里消失时撤卡、同一条审批不叠卡、开关关闭时不画卡、12 秒回收、Web 路径不回归。

## [1.10.3] — 2026-10-21

### 修复

- **桌面端同类系统通知只弹第一条**（#15）：普通通知的 `tag` 原本按类别固定（`dsh-notify-me-<kind>`），靠 `renotify: true` 让同 tag 的新通知替换并重新提示；Electron 不认这个标志，同 tag 的第二条被静默替换，横幅不再出现。现改为每条普通通知独立 tag（`dsh-notify-me-<kind>-<seq>-<ts>`，计数器防同毫秒碰撞）。审批通知的 tag 保持稳定，`closeNotificationTag()` 撤回逻辑不变。

### 测试

- 冒烟新增 `uniqueToastTags()` 回归用例：连发三次「回复完成」断言三条 tag 互不相同、审批 tag 前缀不变；`npm test` 两套件通过。

## [1.10.2] — 2026-10-21

### 变更

- 设置页「提醒方式」重做成一行分段选择器：左边「系统通知」、右边「浮层提醒」，选中的那半填色。原来的两个单选圆点会出现「一个在左一个在右、像在打勾」的错位感，也读不出互斥关系。
- 「浮层位置」只在选了浮层提醒时出现，作为可点开的子项（默认显示当前值，点标题展开）；「音量」同样改为可点开。
- 设置行说明的悬浮提示改为只在标题文字上触发（之前的触发区是整行，空白处划过也会弹）。

### 测试

- 冒烟测试改断言「两个 role=radio 的分段按钮、选中半区带 on」；`npm test` 两套件通过。
## [1.10.1] — 2026-10-21

### 变更

- **悬浮提示的触发区收窄到标题文字本身**：行标题是 flex 列里的子项，会被 blockify 撑满整列，之前鼠标停在标题右侧的空白处也会弹说明。改用 width:fit-content，实测标题宽 52px、文本列 437px，只有压在字上才弹。
- **「浮层位置」「音量」改成点标题展开**：这两项以前跟着上开关立刻出现，页面会突然长出一段缩进区。现在标题后面带 ▸ / ▾，点一下才展开，标题上同时显示当前值（如「右下」「50%」）。
- **提醒停留时间缩到 5 秒档**：普通提醒 5 秒自动收起（浮层「需要你」「回复完成」同档），带「同意 / 拒绝」的审批卡片 12 秒；原来最长的那张一直占屏。

### 测试

- 冒烟：角落下拉折叠后才出现、展开后默认值正确、改值落盘；带按钮卡片 12 秒自收的定时器断言同步更新。
- npm test 两套件通过（ALL SMOKE TESTS PASSED / cordis-host-test passed）。

## [1.10.0] — 2026-10-21

### 新增

- **提醒方式改成二选一**：「系统通知」和「页面浮层」从两个独立开关变成一组单选。两个都开时同一条提醒会弹两遍、浮层还会被系统横幅压住，现在选一个另一个自动关掉。老配置里开着浮层的，升级后自动落到浮层（`readConfig` 迁移，`overlay`/`toast` 两个旧字段继续作为镜像同步，控制台 `setConfig({ overlay: true })` 照旧生效）。
- 设置页里这两个选项改成行首带单选的列表，读起来是一组互斥选项，而不是两个可以同时开的开关。

### 变更

- **停留时间收紧**：普通系统通知 10 秒自动收（带按钮的 20 秒），原来统一 15 秒；浮层卡片「需要你」12 秒、「回复完成」6 秒、带按钮的审批卡片 18 秒——原来带按钮的卡永不自动消失，留着占屏。
- 说明文案同步：系统通知那行直说「桌面端这类通知没有按钮」，浮层那行直说「与上面二选一」；`bridgeOffDesktop` 改成指路——桌面端要按钮就切到浮层，并点明宿主缺 `allowServiceWorkers`。
- `api.debug()` 新增 `channel` 字段。

### 测试

- 冒烟：两个单选互斥的持久化、老配置迁移、切频道时图层清理、两种渠道各自只发一条、带按钮卡片 18 秒自收（用可控 `setTimeout` 捕获定时器）。
- `npm test` 两套件（`smoke-test.cjs` / `cordis-host-test.mjs`）全过。

## [1.9.5] — 2026-10-20

### 说明

- **修正 1.9.4 的口径过重**：实测补充了「有时能上前台」的反馈后重测——1.9.4 说的「0.2.1-rc.2 上失效」不准确，实际是**不稳定**：有时窗口会上前，有时只切对话。
- 复测方法：把 `dsh://open` 深链单独拿出来，三种走法（直接带参启动 exe、走系统协议激活、`WM_SYSCOMMAND` 真实最小化后再发）各 3 次，**全部失败**——带参第二实例每次约 130 ms 后退出码 1（不带参数约 260 ms 退出码 0，正常单实例让位），最小化窗口的 `IsIconic` 每次保持 `true`。⇒ 能抬起来的那些次大概率是系统/Chromium 在通知点击时自己激活了窗口，不是深链。
- README（中英）与设置页提示改为「不稳定」，并写明隔离复测结论。

### 测试

- `npm test` 两套件通过（`ALL SMOKE TESTS PASSED ✔` / `cordis-host-test passed`）。

## [1.9.4] — 2026-10-20

### 说明

- **改口径：桌面端「点通知抬窗」不再当成必然**。DSH Desktop 0.2.1-rc.2（Windows）实测这条链路失效——通知点击回调照常执行（`navigator.userActivation.isActive === true`），但窗口不上前台；带 `dsh://open` 参数的第二实例 133 ms 后以退出码 1 结束，不带参数则 258 ms 退出码 0；用 `WM_SYSCOMMAND` 真实最小化后发深链，`IsIconic` 仍为 `true`，`focusPrimaryWindow()` 的 `restore()` 没生效；壳的 preload 也没有 focus/raise 类 IPC。
- README（中英）：设置清单、「运行环境」说明、「桌面端怎么抬窗的」、已知限制四处按实测结果改写——插件照发深链，原生窗口能否上前台由壳决定；0.2.0-rc.2 上验证通过的结论与「深链必须在用户手势里发」的口径保留。

### 变更

- `lib/client.js`：`hostEnvHint` 中英两版去掉「把窗口带到前台」的确定性表述。

### 测试

- `npm test` 两套件通过（`ALL SMOKE TESTS PASSED ✔` / `cordis-host-test passed`）。

## [1.9.3] — 2026-10-20

### 变更

- **悬浮提示只在行标题上触发**：之前整行（右侧开关、滑块、下拉都算）都是触发区，鼠标扫过控件也会弹方框；现在指针停在标题文字上才出现，开关和滑块保持干净。
- 渐显 320 ms、跟随指针、靠边翻转、滚动收起这些行为不变；读屏隐藏副本不受影响。

### 测试

- 冒烟测试新增四条结构断言：带说明的行必须把提示挂在 `.dnm-rowLabel` 上，该节点持有 `data-dnm-tip` 与三个 hover 处理函数，任何整行节点都不再是提示目标。`npm test` 两套件通过。

## [1.9.2] — 2026-10-20

### 变更

- **设置页的说明文字改成悬浮提示**：每行只留标题，鼠标移上去约 0.3 秒后在指针旁边弹出小方框显示原来的说明；靠近视口右侧/底部自动翻到另一边，滚动即收起。页面因此短了很多，一屏能扫完所有开关。
- 读屏仍能读到完整说明（每行保留视觉隐藏的 `.dnm-srOnly` 文本）；音量百分比、权限提示、外部推送说明这类状态信息仍常显。
- README（中英）与设置页预览截图同步更新；徽章 bundle 尺寸更新为 ~164 KiB。

### 测试

- `npm test` 两套件通过；另在无头 Chromium 里用真 bundle + 假设置外壳验证悬浮出现/跟随/右缘翻转的坐标（`box=544,827 270x50 vw=900` 未越界）与中英两版截图。

## [1.9.1] — 2026-10-20

### 新增

- **设置左侧导航行换成品牌铃铛**：DSH 的设置外壳按分区 id 硬编码导航图标，`settings.section` 没有图标字段，所以插件改为面板渲染后打补丁——按本地化标签找到自己那一行的导航按钮，把宿主生成的 `<svg>` 换成品牌线稿（形状与 `docs/brand/icon-outline.svg` 一致），沿用宿主给的 icon class，并用 MutationObserver 跟随面板重渲染与重开。
- 宿主改结构时补丁静默放弃，显示回默认齿轮，其他功能不受影响。

### 变更

- README（中英）与 `docs/brand/README.md` 的旧口径「导航行图标换不了」改成实际做法与失效条件；`screenshots.json` 补上 1.8.0 / 1.9.0 的截图并修正已删除的 `.jpg` 路径；徽章 bundle 尺寸更新为 ~161 KiB。

### 测试

- `npm test` 两套件通过；另用真 bundle + 合成宿主面板（`data-shortcut-modal="settings"`、`button.navCell > svg + span.navLabel`）在无头 Chromium 里验证：三行导航里只有「通知提醒」变成铃铛（`data-dnm-nav="1"`、三条 shape），另外两行保持齿轮，图标 class 未丢。
## [Unreleased]

### 兼容性
- 适配 `0.2.1-rc.2`（当前 npm latest）：隔离 `DSH_HOME` 起 `dsh web`，启动页 70 个条目里插件排第 59、`application` 批，三个注入目标都在它前面且解析正常；`/plugins/??dsh-notify-me/client.js&rev=…` 返回 1.7.0 构建（140,153 B）；无头 Chromium 载入页面后 `apply` 执行，`window.__dshNotifyMe.debug()` 报 `uiSession: bound`、来源 `sessionStatus`。宿主侧公共 store 与 `0.2.0-rc.2` 同形（`sessionStatus`、`retainedBy.mainView`、`uiWorkspace.openSession()`），**不需要改代码**。
- `package.json` 的 `dsh.compatibility.dshReleases` 补 `0.2.1-rc.2`。`0.2.1-rc.2` 的宿主已不再读取该字段（安装门控只看 `peerDependencies` 与 `engines`），它现在只是给人看的记录。
- README（中英）同步：徽章、实测版本句、代际表、两坑段落与已知限制都补上 `0.2.1-rc.2`。

### 测试
- `npm test` 两套件在 0.2.1-rc.2 的 cordis 4.0.5 上通过（`smoke/smoke-test.cjs` 与真 cordis 腿 `smoke/cordis-host-test.mjs`）。

## [1.9.0] — 2026-10-20

### 新增

- **品牌标志**：`docs/brand/` 收录 24px 线稿、512→32px 应用图标、favicon 与总览图。母题是「铃铛 + 未读圆点」，设置页页眉直接用线稿版内联渲染（不依赖静态资源）。

### 变更

- **设置页重新排版**：页眉（标志 + 一句话说明）之后按「提醒方式 → 什么时候提醒 → 试一试」三段排开，音效来源、外部推送、运行环境与诊断收进折叠的「高级设置」，高级设置右侧列出内含项。原来六张卡片平铺、每行 hint 三四行的样子不再有。
- 每一行的说明压到一到两行，只讲一件事；「音量」作为「提示音」的附属行缩进显示，「位置」作为「页面浮层提醒」的附属行缩进显示。
- README 中英双语同步重排，设置章节与截图换成 1.9.0 的实拍整页图（`docs/screenshots/settings-zh.png` / `settings-en.png`）。

### 说明

- 插件对 DSH 侧仍然只用 `__ModuleLoader__.load`、`settings.section`、`locale` 三个既有面，1.9.0 没有引入任何新的宿主 API：**0.1.1-rc.2 → 0.2.1-rc.2 的插件条目照旧兼容**，退回旧宿主不需要改配置。
- 设置左侧导航行的图标由宿主按分区 id 硬编码（只认 account / models / agent-presets / plugins / archived-sessions），`settings.section` 没有图标字段，插件换不了，已在「已知限制」写明。

### 测试

- smoke 增补：重排后的控件仍能按 `aria-label` 定位；「高级设置」折叠态默认收起、`settingsBoot({ advanced: true })` 展开后能继续走到音效与外部推送；浮层位置下拉仍在默认可见区。

## [1.8.0] — 2026-10-20

### 新增
- **页面浮层提醒**（用户建议：分屏时系统通知只出现在主屏，而主屏基本不看）：Windows 的横幅固定画在主屏，系统没有设置项、Chromium 也没有 API 能把它指到别的显示器，所以新增一条不经过通知中心的通道。配置项 `overlay`（默认关）：在 DSH 页面角落直接画提醒卡片，窗口在哪块屏就出现在哪块屏。
  - 位置 `overlayCorner`：`top-right` / `bottom-right` / `top-left` / `bottom-left`，默认右下，改完立即生效；
  - 不需要通知权限，也不依赖 Service Worker；
  - 审批卡片带「同意 / 拒绝」，走审批卡片自己的 `answer('allowed-once' | 'rejected')`——桌面端（`dsh-app://`，注册不了 Service Worker）因此也能裁决，这是系统通知给不了的；
  - 停留时间：「需要你」20 秒、「回复完成」8 秒，带按钮的审批卡片不自动收；最多叠 4 张；点正文切回对应对话，右上角 × 关闭；
  - 与「系统通知」互不替代，可同时开（主屏 toast + 副屏浮层），也可以只留浮层。
- 设置页「系统通知」下方新增「页面浮层提醒」开关与「浮层位置」下拉（开关打开时才出现位置选项）。
- `window.__dshNotifyMe.debug()` 新增 `overlay` 块（`enabled` / `corner` / `cards`）。

### 变更
- `quickFor()` 的门控从「`quickActions` 且 `toast`」放宽为「`quickActions` 且（`toast` 或 `overlay`）」：浮层是独立的按钮通道，关掉系统通知后仍可裁决。
- 设置页底部按钮提示按渠道如实分流：浮层开着时不再报「快捷裁决按钮暂不可用」，改为「浮层上的「同意」同样等价于「允许一次」」。
- 浮层的清理：HMR 重新注册时先撤掉上一份图层；关掉开关立即撤下所有卡片；审批在别处被裁决（页面审批卡片、通知按钮、会话切换）时对应浮层随之消失，不留可点的陈旧卡片。
- 版本号 1.7.0 → 1.8.0；`window.__dshNotifyMe.version` 与 `package.json` 同步；README 中英同步（简介、基础设置、新增「副屏与浮层提醒」一节、提醒方式、控制台配置块、已知限制），client 体积徽章 137 → 152 KiB。

### 测试
- `smoke/smoke-test.cjs` 新增两段。① 浮层通道：默认不动 DOM、固定图层挂在 `<body>` 下、卡片类名/角色/文案、位置切换与非法值回落、4 张上限、点卡片与 × 撤下、关开关撤层、没有 `Notification` 的环境里审批按钮走完 `decidePending()` 并给出「已模拟同意」反馈、`debug().overlay` 上报。② 设置页浮层两行：开关与位置下拉的出现与持久化、文案、按钮提示分流。
- `npm test` 两套件通过。

## [1.7.0] — 2026-10-16

### 新增
- **外部通知转发**（issue #12）：把「需要你」「回复完成」提醒同时转发到你自己的推送端点，临时离开电脑时手机上的推送渠道照样收到。支持 **Discord Webhook** / **Bark** / **Gotify** / **自定义 Webhook** 四类目标，可配多个、各选类型填地址；负载形状：Discord 走 `{"username":"DSH","content":…}`（正文超长截 1900 字符），Bark 走 `{title, body, group}`，Gotify 走 `{title, message, priority}`（「需要你」priority 8、「回复完成」5），自定义端点收一条 POST JSON `{source, event, title, body, sessionId, time}`。
- 新配置项（默认保守，不填端点就什么都不发）：`externalEnabled`（转发主开关，默认 `false`）、`externalAttention` / `externalDone`（两类提醒各自可关，默认开）、`externalTargets`（推送目标列表）。
- 设置页新增「外部通知」卡片：主开关、「转发「需要你」」「转发「回复完成」」、目标列表（类型下拉 + 地址 + 删除）、添加目标、隐私提示（提醒正文会原样外发，只填自己信任的端点）、「发送测试通知」。
- `window.__dshNotifyMe.testExternal()`：向所有目标发一条测试消息（不受两类提醒开关限制，也不会冒充真提醒），返回 `{sent, unverified, failed, statuses}`；`window.__dshNotifyMe.debug()` 新增 `external` 块（开关状态、目标数/有效目标数、成功/不可确认/失败计数与最后状态）。

### 变更
- 转发挂在 `fire()` 里、本地提醒决定要发之后触发：**跟本地提醒完全同一套触发规则**（「当前对话不弹通知」「页面打开时也提醒」等开关同样管它）；设置页的「测试提醒」按钮与快捷裁决反馈走 `deliver()`，不会误发 webhook。
- 跨域（CORS）口径：先走能读回响应的 CORS POST JSON；被拒（CORS/网络错误）时降级 no-cors + `text/plain` 送出，如实标为「已送出不可确认」（响应对页面不可见是浏览器规则，读不回就没法确认）；Bark 另有经典 GET（`<地址>/<标题>/<正文>`）兜底；HTTP 错误如实记失败、不盲重试。
- 版本号 1.6.1 → 1.7.0；`window.__dshNotifyMe.version` 与 `package.json` 同步；npm 关键词新增 external-notification / webhook / discord / bark / gotify / push-notification / 外部通知 / 推送提醒。
- README（中英）同步：搜索词、设置清单、提醒方式、控制台配置块（四个新键 + `testExternal()`）、已知限制的 CORS 说明；致谢表补 #12（功能建议）。

### 测试
- `smoke/smoke-test.cjs` 新增两段：① 转发链路（默认零外发、toast 测试不触发转发、四类负载形状、真实提醒镜像与两类开关、主开关、no-cors 降级、HTTP 500 单次不重试、Bark GET 兜底、非法 URL 剔除与未知类型归为 custom）；② 设置页「外部通知」卡片（渲染与空状态、目标增删改落配置、测试按钮反馈文案、两种静默原因的提示语）。
- 修掉测试脚手架一处坑：假 React 里 onChange 事件之间不重渲染的话，下一个处理器闭包里的 `cfg` 还是旧的、会把前一次编辑悄悄覆盖（真 React 每个事件之间都会重渲染，产品代码不受影响）。为此把 `settingsBoot` 提升到模块级并补 `renderNow()` / `find` / `findAll` / `configNow()`；`rowSwitch` 开关按钮补 `aria-label`——可及性修正，同时让测试能按名按到。
- `npm test` 两套件均通过（含 `smoke/cordis-host-test.mjs` 真 cordis 腿）。

## [1.6.1] — 2026-10-16

### 修复
- **列表变化里「当前会话」只推导一次，消掉 O(行数 × 会话数)**（性能，issue #13）：`isSubagentSession()` 现在接收调用方已经推导好的当前会话 id。此前它对**每一行**都要重新调 `currentSessionId()`，而 `0.1.6+`（含 `0.2.0-rc.2`）的列表快照已无 `current`，只能 `for (var id in byId)` 扫完整份会话表——一次列表变化因此是「行数 × 会话数」。实测（DSH `0.2.0-rc.2`、**482 个会话**、页面空闲时用 CDP 采 25s 与 38s 两轮 CPU profile）：`currentSessionId()` 自身耗时占 **5.9%~6.5%**，是该页面最热的 JS 函数；修复后同轮 profile 里它退到噪声水平。第二窗口/后台窗口下所有行 `mainView` 为 0 时，旧实现每次都要扫满全表再返回 `null`，这一档同样消失。
- `evalUiStatus()` / `syncDoneFromStatus()` 两个「每个会话一条」的循环同样改为每次 pass 只推导一次。

### 测试
- `smoke/smoke-test.cjs` 新增断言「一次列表变化的 `byId` 枚举次数不随行数增长」（40 行与 4 行必须相等，不写死魔数）。本版基线上改动前该断言报 `9 vs 45`（PR 在 1.5.3 基线测得 `7 vs 43`），修复后为 `5 vs 5`（先写失败断言、先红后绿）。

### 变更
- 版本号 1.6.0 → 1.6.1；`window.__dshNotifyMe.version` 同步。
- README（中英）致谢表补 #13 / #14（性能报告与修复、回归断言）。

## [1.6.0] — 2026-10-15

### 新增
- **设置页可选音效来源**（`soundDone` / `soundAttention`，「需要你」与「回复完成」各自独立）：
  - `'synth'`（默认）——原有 WebAudio 合成音，行为不变；
  - `'custom'`——自选一个本地音频文件（上限 1 MiB，可试听、可移除），提醒时播放该文件；
  - `'system'`——完全不播插件音效，改为把通知以 `silent: false` 发出，交由操作系统播放它自己的通知音（Windows 通知中心／macOS 通知中心），音色跟着系统通知设置走。
- 设置页新增「音效来源」卡片：两类提醒各一行来源下拉 + 「试听」，选「自定义音频文件」时展开文件选择、已选文件名与体积、「试听」「移除」。
- `window.__dshNotifyMe.debug()` 新增 `soundDone` / `soundAttention`（当前生效来源）与 `customSoundDone` / `customSoundAttention`（该类别是否已存自选文件）。

### 变更
- **通知的 `silent` 不再硬编码为 `true`**：改为 `!systemCue(kind)`。默认两种模式仍是 `silent: true`（插件自己出声，避免与平台提示音叠成两声），只有 `'system'` 模式主动让平台出声。主开关 `sound: false` 仍会连系统通知音一起静音——关掉声音就该是安静的。
- 自选音频存在**独立的 localStorage 键**（`dshNotifyMe.sound.done` / `dshNotifyMe.sound.attention`，值为 `{name, size, data}`），不塞进 `dshNotifyMe.config`：data URL 会膨胀约 1.37 倍，进配置会拖慢每次 `readConfig()`（每次提醒都会调用）。
- `resetConfig()` 与设置页「恢复默认设置」现在**一并清掉**这两个音频键，不再只清配置——否则文件会残留占用 origin 配额，而 UI 上已经没有入口能删它。
- **任何来源取不到声音都回落到内置合成音**（文件缺失、解码/自动播放被拒、超出配额），提醒不会因为音效配置坏掉而变成哑的。
- 版本号 1.5.3 → 1.6.0；`window.__dshNotifyMe.version` 与 `package.json` 同步。
- README（中英）同步：设置清单加「音效来源」，控制台配置块补 `soundDone` / `soundAttention` 与两个存储键的说明。

### 修复
- **「系统通知音」模式下点「试听」不再静默无反应**：该模式本就没有插件可播的音（声音是随通知由系统播放的），而初版实现让试听照样走插件音效通道、在 `'system'` 分支直接返回，按钮看起来就是坏的。现在改为按该类别**发一条测试通知**——你听到的就是它，并在按钮下方写明原因；`sound` 总开关关闭时同样给一句说明而不是静默。

### 测试
- `smoke/smoke-test.cjs` 新增音效来源用例段（**此前音效路径零覆盖**——harness 的 `AudioContext` 是 `undefined`，所有既有用例都静默走了「无音频」分支）：注入可捕获的 `AudioContext` 后，覆盖内置合成音的两种音型（done `659,988`、attention `880,1174,1568`）、`'system'` 不产生振荡器且通知 `silent === false`、`sound: false` 在 `'system'` 模式下重新静音、`'custom'` 播放所存 data URL 且音量跟随滑块、两类来源互不影响、文件缺失或浏览器拒绝播放（`play()` 异步拒绝）时回落内置音、`resetConfig()` 清空两个音频键。
- 同一文件新增设置页渲染用例：`bootBundle` 支持注入 `require`（此前固定返回 `{}`，设置页永不注册、无法被测试），用例断言 `settings.section` 注册成功、「音效来源」两张卡片渲染、`custom` 时才出现文件选择行并显示文件名与体积，以及**按下 `'system'` 行的「试听」确实发出一条 `silent === false` 的测试通知**（为此假 React 改为按索引跨渲染保持 hook 状态，能读到点击后的反馈文案）；默认路径（不注入 react）行为不变。
- `npm test` 两套件均通过；`smoke/cordis-host-test.mjs` 用 `DSH_NODE_MODULES` 指向本机 DSH 安装后**真跑**（此前在多数机器上静默 SKIP），真 cordis 下的 `inject` 语义守卫一并复核通过。

## [1.5.3] — 2026-10-04

### 新增
- **设置页底部常显插件版本号**（`dsh-notify-me v…`，中英跟随界面语言）：报障、核对是否装上新版本时直接照抄这一行，不必再开控制台查 `window.__dshNotifyMe.version`（该字段保留）。

### 变更
- 版本号 1.5.2 → 1.5.3；`window.__dshNotifyMe.version` 同步。
- README（中英）：「桌面端怎么抬窗的 / How the Desktop window gets raised」补真实壳复测结论与触发时机口径——深链必须在带用户手势的处理器里发（通知 `onclick` 自带手势，产品路径通）；无手势的脚本化注入会被 Chromium 静默丢弃、外部协议不回流，复现时看似「通道被拦死」。致谢表补 [#9](https://github.com/chromoany/dsh-notify-me/issues/9)（逐层排查与三轮真实壳复测）。

### 核实
- issue #9 真实壳三轮复测（DSH Desktop 0.2.0-rc.2 / Windows 11）：点通知 = 抬窗 + 切会话一步到位，同会话、跨会话、窗口在后台均稳定 ✅，1.5.2 的抬窗修复确认生效。
- 修正 1.5.2 发布当天「CDP 注入 iframe 导航 0 新进程 ⇒ 沙箱 renderer 拦截外部协议」的判断：从发行包 `lib/main.js` 逐处核对，壳对主窗口既没有 `will-frame-navigate` 拦截、页面无 CSP，非 media 权限（含 `openExternal`）一律放行；真实差异在**用户手势上下文**，与渲染进程的 OS 沙箱无关（OS 沙箱 ≠ iframe 的 `sandbox` 属性，GHSA-p2rr-rvmm-c5fp 只影响后者）。

## [1.5.2] — 2026-10-04

### 新增
- **设置页新增「运行环境」**（默认自动识别）：按页面协议（`dsh-app://` = 桌面端 DSH Desktop）识别 Web 端 / 桌面端，识别不准时可手动指定「桌面端」或「Web 端」。手动覆盖同时决定两件事：点通知的抬窗通道（桌面端 `dsh://` 深链 / Web 端 `window.focus()`）与快捷裁决按钮的可用性标注；覆盖与自动识别不一致时设置页明示检测结果，强选「桌面端」但页面并非 `dsh-app://` 时另提示可能弹「打开应用」确认框。

### 修复
- **桌面端「点击通知回到对应对话」真正把窗口带到前台**（issue #9）：DSH Desktop 的页面跑在 `dsh-app://app`（Electron），DOM `window.focus()` 碰不到原生窗口，此前点通知只在后台切好对话、窗口不上前台。现在点通知正文时页面发一条隐藏 iframe 导航到 `dsh://open` —— 子框架导航不经过壳的 `will-navigate` / window-open 拦截，URL 交给系统协议注册，应用单实例锁的 `second-instance` 处理走壳自己的 `focusPrimaryWindow()`（restore + show + focus）。窗口隐藏在托盘、被别的窗口压住、最小化都能抬回来；切对话行为不变，浏览器端不受影响。

### 变更
- **设置页在桌面端明示快捷裁决按钮不可用**：`dsh-app://` 页面无法注册 Service Worker（实测），审批通知的「同意 / 拒绝」按钮渲染不了、自动退回无按钮样式；此前开关本身毫无标注（只有测试按钮的反馈里带一行原始 `bridge` 状态），容易被当成开关坏了。现在设置页在桌面端直接说明这是宿主限制；「测试『审批按钮』」在无桥环境发普通测试通知时也明说按钮渲染不了。
- **测试按钮的反馈文字移到按钮正下方**：此前落在页面最底部（常在视口外），点了测试看不到任何反馈，像「没反应」；无桥 / 开关关闭时的提示也一并放在同一位置。
- `window.__dshNotifyMe.debug()` 新增 `desktop`（生效环境是否桌面端）、`raiseChannel`（`dsh-deeplink` / `window-focus`）、`hostEnv`（设置值）与 `hostEnvDetected`（自动识别结果）。
- 版本号 1.5.1 → 1.5.2；`window.__dshNotifyMe.version` 同步。
- README（中英）同步：设置清单加「运行环境」，新增「桌面端怎么抬窗的 / How the Desktop window gets raised」一节，「点击通知回到对应对话」「审批通知上直接裁决」两条口径与已知限制（桌面端按钮不可用由「未实测」改为实测结论）。

### 测试
- 抬窗通道实测：最小 Electron 44 复刻（`setWindowOpenHandler` / `will-navigate` 与桌面壳同款拦截、不装 `setPermissionRequestHandler`）上，非沙箱 iframe 导航 `dsh://open` 抬起真实 DSH Desktop 窗口（restore + 前台约 0.8s），沙箱 iframe 被拒（Electron GHSA-p2rr-rvmm-c5fp 修复生效），`window.focus()` 不抬（与 issue #9 结论一致）；`dsh://open` 经系统协议回流四轮实测均可靠抬窗。
- `smoke/smoke-test.cjs` 新增桌面抬窗通道用例段：桌面端点通知正文发 `dsh://open` 深链且仍切对话、浏览器端绝不发深链、`hostEnv` 手动覆盖双向生效（强 Web 桌面页不发链、强桌面 Web 页发链）。

## [1.5.1] — 2026-10-04

### 修复
- **「点击通知回到对应对话」在带按钮的审批通知上补齐窗口调度**：这类通知由 Service Worker 弹出，此前 worker 只把点击转告页面，窗口能不能到前台全押在页面消息回调里的 `window.focus()` 上——那段代码不在用户点击的手势上下文里，Windows 前台抢占规则下窗口可能根本抬不起来。现在 worker 在 `notificationclick` 里按规范用 `client.focus()` 调起窗口。
- **多标签页不再互相抢焦点、一起乱切对话**：worker 的点击转信此前广播给所有同源 DSH 标签页，每个开着的标签页都会聚焦自己并各自切对话。现在一次点击只挑一个窗口（优先当前可见的）调起并切对话，其余窗口只收「不导航」的副本、留在原地；「同意 / 拒绝」按钮照旧只裁决、不调窗口。
- 「点击通知回到对应对话」关掉后的承诺在持久通知上也成立：show 时把该设置记进通知 `data`，worker 据此不调任何窗口；旧版本弹出的遗留通知没有该字段，维持此前行为。

### 变更
- 版本号 1.5.0 → 1.5.1；`window.__dshNotifyMe.version` 同步。
- README（中英）同步：「点击通知回到对应对话」补多窗口口径，「工作原理」补 worker 侧的窗口调度说明。

### 测试
- `smoke/smoke-test.cjs` 快捷裁决桥用例补两个 window client 的点击路由断言：点正文只调起可见窗口并只让它切对话（其余客户端收 `navigate: false` 不动）、点正文不裁决；点按钮不调任何窗口也不切对话；`autoFocus` 关掉时通知 `data.focus` 记 `false`、点击既不调窗口也不切对话。

## [1.5.0] — 2026-10-03

### 新增
- **「完成未读」标题标记**：后台会话的回复跑完、你还没打开看的期间，标签页标题前出现 `✅ 回复完成 · …` / `✅ Reply finished · …`，打开该会话（宿主此时清掉未读）或它再次开跑即消失——离开屏幕再回来，一眼看到哪些跑完了。与「需要你」标记可同时出现（「需要你」在前），宿主改写标题后标记基于新标题重建。未读事实取自宿主：`≥ 0.1.6` 用 `sessionStatus` 行的 `completionUnread`（后台会话完成即点亮，打开 / 再次开跑 / 会话消失即清零），旧宿主用列表行的 `completed` 提醒位（选中会话即清零）。静音中的后台子代理会话照旧不标记；「页面打开时也提醒『回复完成』」开关只管通知，不影响标记。
- **「回复完成」通道接上宿主的完成未读标志**：此前只靠 `running` 快照边沿，页面没看见的完成（插件热重载中途、快照把 true→false 合并成一跳、完成发生在绑定之前）就永远漏掉。现在 `sessionStatus` 的 `completionUnread` 级别标志（0.1.6+）负责补漏——每条未读实例只报一次，绑定时已存在的未读也补报一声；边沿与级别标志是同一次完成的两个视角、同刻到达时按短时间窗合并成一声。边沿路径保持不变：当前会话的正文仍带回复摘要，旧宿主照旧。
- 「等你操作」不算完成：一轮带着 plan-review / 提问结束时只走「需要你」提醒，答完也不补「回复完成」马后炮；宿主仍标未读时，标题标记照常挂到你打开会话为止。后台子代理会话的未读照旧静音，解除静音后补报一次。
- `window.__dshNotifyMe.debug()` 新增 `doneUnreadMarked`（当前挂着「完成未读」标记的会话列表）。

### 变更
- 版本号 1.4.0 → 1.5.0；`window.__dshNotifyMe.version` 同步。
- README（中英）同步：「提醒时机」表、「提醒方式」的标题标记说明、「工作原理」的完成未读级别标志两代取源与合并口径。

### 测试
- `smoke/smoke-test.cjs` 新增 completionUnread 用例段：漏报补发、同刻双视角只响一声、绑定前已有的未读只报一次、等输入的停顿不算完成（答完不补马后炮、标记照旧）、当前会话不走未读通道、后台子代理静音与解除静音、页面可见时只留标记不弹通知、双标记叠加与宿主改标题后的重建；legacy 用例补 `completed` 提醒位的标记出现与「选中会话即撤」。
- `smoke/cordis-host-test.mjs` 在真 cordis `sessionStatus` 宿主上补一条走真 store 的完成未读用例：报告一次、标记、不重复、打开即撤。

## [1.4.0] — 2026-10-03

### 新增
- **子代理会话不提醒**（设置页新开关「子代理会话不提醒」，默认开启）：DSH 把每个子代理（subagent）子会话列成独立会话行（`origin: 'subagent'` 加 `parentId`），于是这些子会话的「需要你」与「回复完成」都会照常弹通知——可它们是所属主对话那一轮里的步骤，提醒只是噪音。现在默认静音**后台**子代理会话：列表行评估与 `sessionStatus` 等待通道都跳过「带 `origin: 'subagent'` 且不是当前会话」的行；你正打开着的那个子代理会话不算静音对象，照常提醒（走当前对话的常规规则：页面可见时默认只留标题标记、转后台补发）。主对话自己的提醒不受影响。
- 判定认 `origin` 加「不是当前会话」两条：只有 `parentId`、没有 `origin` 的分支（fork）会话仍是你自己的对话，照常提醒；静音随你打开的会话实时变化——切进某个后台子代理会话，它积压的等待按当前对话的规则补上，切走后重新回到静音范围（标题标记与排队中的通知一并撤下）。静音开关读的是实时配置，切换后下一条事件即生效，不需要重载页面。
- `window.__dshNotifyMe` 配置新增 `ignoreSubagent`（默认 `true`，可用 `setConfig` / `resetConfig` 调整），`debug()` 新增同名字段便于核对。

### 变更
- 版本号 1.3.1 → 1.4.0；`window.__dshNotifyMe.version` 同步。
- README（中英）补上设置页新开关、提醒时机说明、控制台配置示例与工作原理里的子代理口径。
- README（中英）新增「致谢与贡献须知 / Credits & how contributions land」：外部 PR 的署名口径与贡献者名单；「只静音后台子代理、当前打开的照常提醒」这一口径来自 [#8](https://github.com/chromoany/dsh-notify-me/pull/8) 讨论里的建议（收编进 main 的原版是整条静音），本次按该口径改准并由维护者落地。

### 测试
- `smoke/smoke-test.cjs` 新增子代理用例：`ignoreSubagent` 默认值与 `debug()` 字段、后台子代理完成不提醒而普通后台会话照常、后台子代理等待不提醒也不打标题标记、分支（fork）会话仍提醒、关掉开关后子代理的等待与完成重新提醒，以及「当前打开的子代理会话照常提醒」——等待与完成都提醒；后台积压的等待在切进去时按当前对话的规则排队补发，切走则连标题标记与排队通知一起撤下。

## [1.3.1] — 2026-10-03

### 文档
- README 中英补齐 1.1.7 / 1.1.8 起就有、但一直没写进文档的两个设置项：「当前对话不弹通知」（`currentHiddenOnly`）与「点击通知回到对应对话」（`autoFocus`），控制台配置示例同步补 `currentHiddenOnly`；「提醒时机」表的默认口径改为「页面可见也提醒（当前对话除外：默认只留标题标记）」——原表述把当前对话的静默规则漏掉了。
- 措辞去掉 Windows 专属口径：系统通知按「经浏览器弹出，进 Windows 通知中心或 macOS 通知中心」描述，权限提示补 macOS 的 系统设置 → 通知；已知限制新增 macOS 一条——浏览器路径无平台假设，但 DSH Desktop（Electron）的系统通知要求应用已签名（官方 macOS 版是否满足未实测），审批按钮在 macOS 与桌面宿主上的渲染同样未实测，不渲染时自动退回无按钮通知。
- 已知限制补「当前对话不弹通知」按 `document.hidden` 判定的边界（窗口被别的应用完全盖住仍算可见）；开发自检一节补 `cordis-host-test.mjs` 的 cordis 探测路径（含 `~/.dsh/profiles/node_modules` 平铺回退目录）。

### 变更
- 版本号 1.3.0 → 1.3.1；`window.__dshNotifyMe.version` 同步。功能零改动。

## [1.3.0] — 2026-10-03

### 新增
- **审批通知上直接裁决**（设置页新开关「审批通知上直接裁决」，默认开启）：权限审批的系统通知带上「同意 / 拒绝」按钮，点一下就完成裁决，不用切回页面。按钮调的是审批卡片自己的 `PendingApproval.answer('allowed-once' | 'rejected')`——「同意」即「允许一次」，只放行这一次，与卡片上的按钮完全同义；点通知正文仍是 1.1.8 的「回到对应对话」。
- 绕开的是一条浏览器硬限制：`actions` 只属于 Service Worker 弹的持久通知，往 `new Notification()` 里传 `actions` 直接抛 `TypeError`。所以 bundle 一份文件两用：页面里照常注册提醒工厂，同一份字节再注册成 Service Worker，只负责把「点了哪个按钮」（同意 / 拒绝 / 点正文）转告页面（BroadcastChannel 与客户端 postMessage 双通道），裁决本身仍发生在页面里。注册只用本插件自己的单条目 combo URL（`/plugins/??dsh-notify-me/client.js&rev=…`，取自 `__DSH_BOOT__.entries`）——多插件 combo 会在 worker 里执行别家的 factory，注册必挂。
- 按钮通知按交互 key 记账：一条等待一次只认领一张通知；页面里先答掉、或被新请求顶替之后，残留通知上的按钮再点不裁决任何东西，只把通知关掉。请求消失时残留通知一并关闭；带按钮的通知不设 15 秒自动消失，未裁决的审批留在通知中心等你。
- `window.__dshNotifyMe` 新增 `decide(key, outcome)`（按钮的程序化同款，`outcome` 取 `"allowed-once"` / `"rejected"`）与 `test("approval")`（设置页新增「测试『审批按钮』」按钮，一条通知端到端验证按钮链路）；`debug()` 新增 `quickActions` / `bridge`（`active` = 按钮可用，否则给出不可用原因）/ `actionKeys`；`onEvent` 新增 `decision` 事件（`{key, outcome, sessionId}`，测试点击另带 `test: true`）。

### 变更
- 带按钮的审批通知改用 `dsh-notify-me-attention-<key>` 独立标签，多条待审批互不顶掉；提问 / 方案确认沿用原来的 `dsh-notify-me-attention` 标签行为。
- 不支持 Service Worker 的环境（`http://` 局域网地址等）自动退回 1.2.x 的无按钮通知，其余功能不受影响，`debug().bridge` 显示具体原因。
- 版本号 1.2.1 → 1.3.0；`window.__dshNotifyMe.version` 同步。

### 测试
- `smoke/smoke-test.cjs` 新增快捷裁决桥用例，把 bundle 的两半都在同一套件里跑起来（worker 半侧执行在 worker 形状的 vm 上下文，页面半侧走常规桩，两边用同一个 BroadcastChannel 桩对接）：单条目 combo URL 注册、按钮文案与 `data` 携带 key/会话、点「同意」→ `answer('allowed-once')`、点「拒绝」→ `answer('rejected')`、陈旧 key 与未知 key 一律不裁决、页面里先答掉后残留按钮失效、`quickActions` 关闭或无 Service Worker 时退回普通通知且不带 `actions`（构造函数带它会抛 `TypeError`）、测试按钮走完整 worker 链路。
- `smoke/cordis-host-test.mjs` 在 `sessionStatus` 宿主上补真 cordis 语义的裁决用例：`decide()` 经 `ctx.get("uiSession")` 找到活着的交互并调它的 `answer()`，重复裁决与未知 key 拒绝，标记随之释放。

### 已知限制
- 按钮要 Service Worker：`http://127.0.0.1`、`https` 可用，`http://192.168.x.x` 这类局域网地址不行；DSH Desktop（Electron）里按钮能否渲染未实测，不渲染时按上述降级走无按钮通知。

## [1.2.1] — 2026-10-03

### 修复
- **提示音叠着响两声**：`new Notification(...)` 没带 `silent: true`，平台自带通知音与插件自己的 WebAudio 提示音各响一遍。现在通知一律静音，声音统一由插件承担（attention / done 两种音型、音量设置不变）；设置页「提示音」关掉即完全安静。

### 变更
- `smoke/cordis-host-test.mjs` 借用 cordis 的探测路径补上 `~/.dsh/profiles/node_modules`（`healProfilesModuleFallback` 维护的平铺回退目录）：此前只探测 `profiles/web/node_modules`，多数机器上最强的那套真 cordis 端到端用例会静默跳过。

## [1.2.0] — 2026-09-30

### 修复
- **`0.1.6-alpha.2` 及以后（含 `0.2.0-rc.2`）宿主上「模型需要你操作」整条通道再次静默失效**：上游把待办交互从 `uiSession.pendingInteractions`（`Map<sessionId, interaction>`）搬进了 `uiSession.sessionStatus`（`Map<sessionId, {running, pendingInteraction, completionUnread}>`），旧 store 在新宿主上根本不存在——插件读不到就静默不提醒（审批卡片出现、模型停下，系统通知/提示音/标题标记全无；而「回复完成」与设置页测试按钮照常，现象与 1.1.5 那次一模一样）。现按宿主代际自动选源：`≥ 0.1.6-alpha.2` 绑定 `sessionStatus`，`0.1.2 .. 0.1.5` 仍用 `pendingInteractions`，`≤ 0.1.1` 仍走控制器快照；`window.__dshNotifyMe.debug()` 新增 `uiSessionSource`，直接显示这条通道绑的是哪个来源。
- **`0.1.6` 及以后的宿主上认不出「当前会话」**：会话列表快照不再有 `current`（`SessionListState` 只剩 `ids / byId / phase / projectionsBySession`），于是当前会话面（face）订阅从未建立、`onListChanged()` 还把当前会话当成后台会话评估——后果是 1.1.7 的「当前对话不弹通知」规则失效（审批卡片就在屏幕上，Toast 仍会盖上去），标签页标记的归属也随之错位。现在按宿主自己的口径推导：有 `current` 用它，没有就取 `retainedBy.mainView > 0` 的那一行（与内置 `DocumentTitle` / `ui-workspace` / `ui-session` 的判定一致）。
- **`0.1.6` 及以后点通知切不回对应会话**：`sessions.open(id)` 已被移除，导航改由 `uiWorkspace.openSession(id)` 承担；插件现在两个都试（`open` 优先，旧宿主行为不变），会话已不在列表时依旧不调用。`debug()` 新增 `currentSession` 便于核对。

### 变更
- 提醒语义在适配后原样保持（1.1.x 既有逻辑，不是新行为）：同一会话里等待被替换成新 key 时旧的标题标记随之释放，等待消失（`pendingInteraction` 变 `null`）时按 key 释放标记，重复通知不重复提醒。
- `peerDependencies` 放宽为 `^0.1.0-rc.6 || ^0.1.1-rc.2 || ^0.1.2-rc.1 || ^0.1.5-rc.1 || >=0.1.6-alpha.2 <0.2.0-0 || >=0.2.0-rc.1 <0.3.0-0`：原范围在 `0.2.0-rc.2` 上被 `evaluatePluginCompatibility` 判为不兼容，`dsh plugin add` 会拒绝并回滚安装（`0.3` 线仍被拒）。`dsh.compatibility.dshReleases` 增加 `0.2.0-rc.2: compatible`。范围对未实测的 `0.2.x` 正式版同样放行，是否兼容以 `dshReleases` 的实测声明为准。
- 版本号 1.1.8 → 1.2.0（新宿主代际）；`window.__dshNotifyMe.version` 同步。
- 设置页字典注册改为把 `locale.register()` 返回的 disposer 交给 `ctx.effect`（与官方 `ui-approval` 写法一致），客户端插件 HMR 重载时不会因「同名 namespace 已注册」而丢掉设置页。
- `uiSession` 绑定的诊断降噪：真实 `0.2.0-rc.2` 页面上每次加载都会出现的那条 `uiSession is provided but not reachable` 警告其实是**启动竞态**（本插件的客户端条目常早于 `ui-session` 条目激活，此时 `ctx.get()` 按 cordis 的严格语义拿不到尚未激活的服务），并非缺陷。现在只有**能拿到服务实例、但它既没有 `sessionStatus` 也没有 `pendingInteractions`** 时才打一条警告（并提示附上 `debug()` 输出）；「还没可见」保持安静，由 1.5s 重试定时器接管，`debug().uiSessionNote` 仍可查。

### 测试
- `smoke/smoke-test.cjs` 增加第三代宿主用例（`uiSession.sessionStatus`、列表无 `current`、无 `sessions.open`）：审批/提问/方案确认文案与详情、去重、等待消失释放标记、挂载前已存在的等待提醒一次、当前对话静默 + 转后台补发、后台会话前台提醒、主开关、`retainedBy.mainView` 推导当前会话、点通知走 `uiWorkspace.openSession`、会话已消失不打开。
- `smoke/cordis-host-test.mjs` 增加真 cordis 的 `sessionStatus` 宿主（兄弟插件提供 `sessionStatus` 与 `uiWorkspace`，`sessions` 不带 `open`）：断言订阅绑到 `sessionStatus`、审批只提醒一次且正文带工具名 + 理由、标题标记设置与释放、点通知调用 `uiWorkspace.openSession`。原有 `pendingInteractions` 宿主与无 `uiSession` 的旧宿主用例保留。
- 自检命令补 `DSH_CORDIS_PATH`：源码 checkout 里没有 profile 依赖时，用它把 `cordis-host-test.mjs` 指向 checkout 内的 `vendor/cordis/lib/index.js`（否则该用例按设计跳过）。

### 已知限制
- `≥ 0.1.6`（含 `0.2.0-rc.2`）的「回复完成」提醒正文不再附带回复摘要：宿主快照不再提供 `nodes`，摘要取不到；提醒本身照常触发。

## [1.1.8] — 2026-09-24

### 新增
- **点通知直接回到那条对话**：系统通知现在带着它所属的会话 id，点一下就用 `sessions.open(id)` 把那个会话切成当前会话——以前只把 DSH 窗口带到前台，还得自己找是哪条在等。若该会话已经不在列表里则不调用（`open()` 对未知 id 会直接抛错），点击仍会把窗口带到前台。
- `onEvent` 回调的 payload 增加 `sessionId`。

### 变更
- 设置项「点击通知把 DSH 切回前台」改为「点击通知回到对应对话」并补上说明；关掉后点击通知依然不做任何事。
- 顺手加固 `canToast()`：某些策略下 `Notification` 存在但读 `permission` 会抛错，原来会把整条投递链（连 `onEvent` 一起）打断，现在只在确认不了权限时按「不能弹」处理。
- 测试：两个套件各补「点击通知 → 宿主收到 `open(该会话)`」与「会话已消失 → 不调用 `open`」的用例。

## [1.1.7] — 2026-09-24

### 新增
- **当前对话的「需要你」提醒不再弹通知**（设置页新开关，默认开启）：当等待就发生在你正看着的那个对话里、且页面在前台时，只保留标签页标记，不弹系统通知、不响提示音——审批卡片本来就在屏幕上，Toast 只会盖住它。页面一转到后台，被压下的那条提醒立刻补发；若在补发之前你已经处理掉了，它随之作废。
- `window.__dshNotifyMe.debug()` 增加 `currentHiddenOnly` 与 `quietedKeys`（当前被压下、等着补发的提醒 key）。

### 变更
- 页面可见时**其它会话**（后台会话）的等待照常提醒，不受这条规则影响；把开关关掉即恢复 1.1.6 的行为。
- 测试：`smoke/smoke-test.cjs` 与 `smoke/cordis-host-test.mjs` 各补用例——「当前会话 + 前台 → 静默并排队」「转后台 → 补发一次」「当前会话 + 前台 + 已处理 → 不补发」「后台会话 + 前台 → 照常提醒」，并在两代宿主（`uiSession` 路径与 controller 路径）上都覆盖。

## [1.1.6] — 2026-09-24

### 修复
- **1.1.5 的「模型在等你操作」修复在真机上从未生效**（现象与 1.1.5 条目描述的一模一样：审批卡片出现、模型停下等待时，没有系统通知、没有提示音、标签页标题也不变；而「回复完成」提醒和设置页的测试按钮一切正常）。根因是**取服务的方式**：`bindUiSession()` 用 `rootCtx.uiSession` 属性读取，而 **cordis 4 只解析写在插件 `inject` 映射里的服务名**，其余名字一律抛 `cannot get property "uiSession" without inject`——同一 fiber 的兄弟条目（`dsh-client-ui-session`）提供的服务不会出现在祖先 store 里，属性查找必然落空；外层那个 `try/catch` 把这个异常吞成 `svc = null`，订阅永不建立，而 `0.1.2+` 的旧快照路径已经没有 `pending` 可用，待办提醒因此全程哑火。
  - 改用 **`ctx.get("uiSession")`**：这是 cordis 明文的「无需 inject 读取服务」通道；`ctx.reflect.get()` 与属性读取保留为该 API 之前的兜底。服务实例被换掉时（插件 HMR）也会重新绑定，而不是抱着旧 store 的失效订阅。
  - **仍然不把 `uiSession` 写进 `inject`**：那会让本插件在所有 `0.1.2-alpha.2` 之前的宿主上永远停在 `pending`（1.1.4 踩过的坑），而 cordis 的 `inject` 只有「必需」一种语义，没有可选依赖。

### 新增
- **`window.__dshNotifyMe.debug()`**：输出当前绑定状态（`uiSession: bound|unbound`、失败原因 `uiSessionNote`、会话基线与待办基线数量、已提醒 key、通知权限、页面可见性、最后一次提醒时刻）。这条链路失败时原本没有任何可见信号，排查只能翻宿主源码——这正是本次要补上的东西。
- 服务「已被某个条目提供、却拿不到」时打一条 `console.warn`；旧宿主根本没有该服务属于正常情况，保持安静。

### 变更
- 新增 `smoke/cordis-host-test.mjs`：用**真正的 cordis 4** 起根上下文、由兄弟插件提供 `uiSession`，把 `lib/client.js` 真身挂上去端到端验证。先断言宿主语义本身（属性读取必抛 `without inject`、`ctx.get()` 必能解析），再驱动一次 `approval` 交互，断言弹出提醒（标题「DSH · 审批请求」、正文带 `toolName · reason`）、标题标记、同 key 不重复、交互消失后释放标记；最后再跑一遍无 `uiSession` 的旧宿主路径。找不到本机 DSH 安装时自动跳过。
- `npm test` 现在依次跑 `smoke/smoke-test.cjs` 与 `smoke/cordis-host-test.mjs`。

### 更正
- 1.1.5 条目里「本版改为订阅该 store」的结论不成立：订阅从未建立。1.1.5 的测试之所以通过，是因为 `smoke/smoke-test.cjs` 传入的是**手写假 ctx（普通对象）**，`ctx.uiSession` 属性读取不经过 cordis 的 inject 门控——假 ctx 上的成功掩盖了真宿主上的失败。教训：用真宿主语义的 ctx 跑插件真身，比手写桩更能说明问题。

### 文档
- 新增 `docs/listing.md`：记录各插件目录/市场的收录方式（提交物、合并方式），以及本插件当前的收录状态；并记下 `awesome-dsh-plugin` 站点构建失败的排查入口（`build-site.yml` 最近一次运行 / issue #4731）。
- issue #1 / #2 报告的「等待审批 / 提问 / 方案确认不提醒」：1.1.5 判对了病因、开错了药（见上），1.1.6 才是真正生效的修复。

## [1.1.5] — 2026-09-14

### 修复
- **「模型在等你操作」这一路提醒在 DSH `0.1.2-alpha.2` 及以后的运行时上完全不触发**（现象：审批卡片出现、模型停下等待时，没有系统通知、没有提示音、标签页标题也不变；而「回复完成」提醒一直正常）。根因是两个待办数据源同时被上游搬走：
  - 选中会话的快照 —— `SessionSnapshot.pending` 已不存在（0.1.2-alpha.2 起只剩 `queue / pendingSubmissions / running / …`）；
  - 会话列表行摘要 —— `SessionSummary.pendingInteraction` 已不存在（只剩 `running / completed`）。

  待办交互改为由 `dsh-client-ui-approval` / `dsh-client-ui-user-questions` 经 `ctx.uiSession.registerPendingInteraction()` 发布到**独立 store** `ctx.uiSession.pendingInteractions`（`Map<sessionId, interaction>`，`interaction.kind` 为 `approval | question | plan-review`）。本版改为订阅该 store：新出现的交互弹一次提醒（`PendingApproval` 取 `toolName` / `reason`，`PendingQuestion` 取 `questions[0].question`），交互消失时释放标签页标记，挂载时已存在的等待也提醒一次。
  - **为什么不把 `uiSession` 写进 `inject`**：客户端条目的 `inject` 是**硬门控**——服务不存在时条目会永远停在 `pending`，而 web 启动断言会因「有条目未激活」直接抛错（这正是 1.1.3/1.1.4 两次踩过的坑）。`uiSession` 只存在于 `0.1.2-alpha.2` 及以后，写进 `inject` 会让本插件在 `0.1.1-rc.2` 上彻底失效。因此改为**惰性查找**：拿得到就订阅交互 store，拿不到就静默走旧的快照路径，两代宿主都保留完整功能。
  - 保留 `@deepseek-ai/dsh-client-ui-session` 在 `dsh.client.inject` 中（它是客户端加载图里的 bundle 条目，与服务门控无关）；实测该条目在加载图顺序上位于 `@deepseek-ai/dsh-client-ui-session` 之后（54 个条目中第 44 位 vs 第 10 位），且官方 `dsh-client-ui-approval` / `dsh-client-ui-user-questions` / `dsh-client-ui-open-in-app` / `dsh-client-ui-layout` 等同样以 `"uiSession"` 为服务依赖。

### 变更
- 两条来源同时可用时按交互 key 去重：同一次等待只提醒一次、也只有一个标签页标记；标题标记的归属固定给交互 store（可用时），避免两路各记一个标记。
- 测试：`smoke/smoke-test.cjs` 拆成**两代宿主**各跑一遍——旧宿主（无 `uiSession`，快照带 `pending`）与新宿主（`uiSession.pendingInteractions`），新增「重复通知不重复提醒」「挂载前已存在的等待仍提醒一次」「多会话并发等待各提醒一次并逐个释放标记」「两路去重」「主开关关闭时交互通道同样静音」等回归用例。

## [1.1.4] — 2026-09-13

### 修复
- **插件在 DSH `0.1.2-rc.1` 及以后的运行时上一直没有真正激活**（表现为：桌面端/网页端都不弹提醒、设置里也没有「通知提醒」分区，而启动清单里又能看到条目）。根因是 `dsh.client.inject` 里残留了 `@deepseek-ai/dsh-client-runtime`：该包从 `0.1.2-rc.1` 起已从官方客户端依赖图移除（`sessions` 服务改由 `@deepseek-ai/dsh-client-ui-session` 提供），而客户端条目的 `inject` 目标是**硬门控**——解析不到就停在 `pending (waiting for services: …)`，`apply` 永不执行。1.1.3 为兼容 0.1.0/0.1.1 线而保留该条目，正是这一处让插件在 0.1.2-rc.1 起的版本上全程哑火。
- 相应地，`dsh.client.inject` 现在只保留 `@deepseek-ai/dsh-client-ui-session` / `@deepseek-ai/dsh-client-locale` / `@deepseek-ai/dsh-client-ui-conversation` 三个官方包。

### 变更
- 兼容声明补到实测激活的 `0.1.5-rc.1` / `0.1.5-rc.2`（DSH Desktop 2.0.9 内置 0.1.5-rc.2 线）；`peerDependencies` 范围同步放宽到 `^0.1.5-rc.1`。
- 兼容性验证口径改为**「插件真的激活」**：在独立 `DSH_HOME` + 独立 profile 里启动目标版本，检查设置页出现本插件注册的「通知提醒」分区，而不只是看启动清单里有没有这个条目。

### 更正
- 1.1.3 的验证记录不成立：当时只确认了「条目进入 `__DSH_BOOT__`、`/plugins/??dsh-notify-me/client.js` 返回 200」，**没有验证插件是否被激活**，因此 `0.1.2-rc.1: compatible` 的声明与事实不符（该版本上插件同样被同一处 inject 门控）。同版条目里「原条目保留，供 0.1.0/0.1.1 线使用」的判断作废——保留即致命。

## [1.1.3] — 2026-09-09

### 新增
- **逐版本兼容声明**：`package.json` 增加 `dsh.compatibility.dshReleases`，声明 `0.1.1-rc.2` 与 `0.1.2-rc.1` 为 `compatible`（DSH-Store 目录用该矩阵决定条目是否保持上架）。
- **0.1.2-rc.1 实测记录**：用独立的 `DSH_HOME` + 临时 profile 启动 0.1.2-rc.1 的 web 应用，插件客户端模块进入 `__DSH_BOOT__`（47 个条目之一），`/plugins/??dsh-notify-me/client.js` 返回 200 且按 `__ModuleLoader__.load` 注册；运行时需要的 `sessions`（0.1.2 起由 `dsh-client-ui-session` 提供）、`locale` 与 `slots`（`dsh-client-locale`）三个服务均存在。

### 变更
- `dsh.client.inject` 补上 `@deepseek-ai/dsh-client-ui-session`：0.1.2-rc.1 已移除 `@deepseek-ai/dsh-client-runtime`，`sessions` 服务改由前者提供（原条目保留，供 0.1.0/0.1.1 线使用）。
- `peerDependencies` 由 `@deepseek-ai/dsh-client-runtime` 改为实际依赖的 `@deepseek-ai/dsh-client-locale`，范围扩到 `^0.1.2-rc.1`；仍为 optional。

## [1.1.2] — 2026-09-08

### 变更
- **README 新增「为什么需要它」**（中英双语）：把定位写清楚——不开完整访问要付「等待」成本，开了要付「不可逆风险」成本；插件把「监督」与「守在屏幕前」解耦，**让你敢不开完整访问**，并注明它不降低 full access 本身的权限风险（它不是沙箱）。
- README 预览图改用绝对地址：`docs/` 不在发布文件集内，相对路径在 npm 页面会裂；简体版补齐 bundle 体积 badge，与英文版对齐。
- 中文正文标点统一：半角 `;` → `；`，直引号 `"…"` → `「…」`。
- 仓库新增 `.gitignore`（`node_modules/`、`.npm-cache/`、`*.tgz`）。

### 修复
- `window.__dshNotifyMe.version` 与包版本脱节（停在 `0.2.0`），现随 `package.json` 同步为 `1.1.2`。
- `CHANGELOG` 1.0.0 条目中的字面量 `\n`（页面上会渲染成 "\n"）改为真实换行；1.0.1 条目英文措辞自相矛盾处修正；版本链接修正为真实存在的目标（1.0.0 / 1.0.1 没有对应 git tag，原链接 404）。

## [1.1.1] — 2026-09-08

### Fixed
- **测试按钮不再被「页面打开时也提醒」开关吞掉**：页面可见且「回复完成」保持默认（仅后台提醒）时，点「测试「回复完成」」现在会正常弹出提醒——测试路径改为绕过可见性规则（只受主开关与浏览器通知权限影响），并补上对应的回归用例。
- 「需要你」测试提醒的标签页标记约 6 秒后自动消失，不再留下一个看起来像「真有待办」的常驻标记。

## [1.1.0] — 2026-09-08

### Added
- **设置入口**：DSH web 的 **设置 → 通知提醒** 新增独立设置页（`settings.section` 槽位，浏览器半身可选 React 呈现，缺失能力时自动降级为纯提醒）：主开关、系统通知/提示音/音量、两种场景的可见时提醒开关、点击通知聚焦开关，以及 **通知语言**（跟随界面 / 简体中文 / English）与一键测试、恢复默认。
- **通知语言**：提醒文案（通知标题/正文/`🔔 …` 标题标记）不再硬编码中文——`language` 配置支持 `auto`（跟随 DSH 界面语言）/ `zh` / `en`；页面重新加载后按需即时解析。
- **总开关**：`enabled` 配置（默认开），关闭后不发通知、不响铃、不改标签页标题。
- **可发现性**：`package.json` 新增中英关键词（消息提醒 / 可操作提醒 / 桌面通知 / 需要你操作 / 回复完成提醒 / 后台完成提醒 / desktop-notification / message-alert / approval-alert 等），description 与 README 首页同步补齐搜索词。

### Changed
- `lib/client.js` 重写：提醒核心保持零第三方依赖与自包含；新增语言解析/多语言文案表与可选 Settings 页面（依赖 `slots`/`locale`/`react`，注册前做能力守卫）。
- 冒烟测试扩展：覆盖主开关、`language` 中英切换后的通知文案与标题标记、`resetConfig` 恢复新增默认项。

## 1.0.1 — 2026-09-08

### Changed
- README is now a **Simplified-Chinese-primary** homepage (`README.md`) with a parallel English version (`README.en.md`) and this changelog, mirroring the ecosystem's documentation conventions.
- `package.json`: added `publishConfig.access: public`, `repository`/`homepage`/`bugs` links, and added `README.en.md` + `CHANGELOG.md` to the published `files` set.

## 1.0.0 — 2026-09-08

### Added
- First release. Browser-layer desktop reminder plugin for the DeepSeek Harness web UI.
- 🔔 **Needs-your-input alerts**: fires on new pending interactions — sandbox `approval`, `plan-review`, and `question` (`ask_user_question`) — with toast + sound + `🔔 需要你 ·` tab-title marker (alerts even while the page is visible).
- ✅ **Reply-finished alerts**: detects the selected session's `running: true → false` edge (and background sessions' completion) — toast + sound, by default only while the page is hidden/backgrounded.
- Clicking a toast focuses the DSH window.
- Zero-UI, zero-server-logic: pure client-side bundle subscribing to the `sessions` service; preferences in `localStorage`; auditable, self-contained code (`<20 KB` at 1.0.0).
- Offline smoke test (`smoke/smoke-test.cjs`) covering the alert state machine.
- Screenshot + `screenshots.json` for the plugin-market page; UI preview shown in the README.

<!-- versions -->
> 1.0.0 与 1.0.1 早于本仓库的 GitHub 标签历史（tag 从 `v1.1.0` 起，且 npm 上只有 1.0.0 / 1.1.0 / 1.1.1），故不附链接。

[1.1.4]: https://github.com/chromoany/dsh-notify-me/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/chromoany/dsh-notify-me/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/chromoany/dsh-notify-me/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/chromoany/dsh-notify-me/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/chromoany/dsh-notify-me/releases/tag/v1.1.0
