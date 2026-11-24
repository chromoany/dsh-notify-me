<div align="center">

<img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/brand/header.jpg" width="100%" alt="倉庫頭圖：深色桌面上亮起的鈴鐺標誌，標題 dsh-notify-me，副標題 Step away. Stay informed.">

<h1 align="center">dsh-notify-me</h1>

**離開 DSH 頁面，也能及時知道何時需要回來。**

[简体中文](README.md) | 繁體中文 | [English](README.en.md)

[![npm version](https://img.shields.io/npm/v/dsh-notify-me?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/dsh-notify-me)
[![npm downloads](https://img.shields.io/npm/dm/dsh-notify-me?style=flat-square&label=downloads%2Fmonth&color=1F883D)](https://www.npmjs.com/package/dsh-notify-me)
[![npm total downloads](https://img.shields.io/npm/dt/dsh-notify-me?style=flat-square&label=total%20downloads&color=1F883D)](https://www.npmjs.com/package/dsh-notify-me)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![test](https://github.com/chromoany/dsh-notify-me/actions/workflows/test.yml/badge.svg)](https://github.com/chromoany/dsh-notify-me/actions/workflows/test.yml)
[![DSH Web and Desktop](https://img.shields.io/badge/DSH-Web%20%7C%20Desktop-blue?style=flat-square)](#安裝)
[![Package size](https://img.shields.io/npm/unpacked-size/dsh-notify-me?style=flat-square&label=package%20size)](https://www.npmjs.com/package/dsh-notify-me)
[![DSH Compatibility](https://img.shields.io/badge/DSH-%E5%B7%B2%E9%81%A9%E9%85%8D%200.2.2--rc.5%20%2F%200.2.1--rc.5-6366f1.svg?style=flat-square)](#相容性)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

</div>

[效果預覽](#效果預覽) · [安裝](#安裝) · [設定](#在-dsh-設定裡調整) · [相容性](#相容性) · [已知限制](#已知限制) · [更新日誌](CHANGELOG.md)

DSH Web / Desktop 的通知插件，讓你敢不開完整存取，也不必一直守著頁面。

- **需要你操作時**：核准、方案確認、提問，用通知、提示音和標題標記提醒。
- **後台回覆完成時**：及時回來檢視結果，點選通知可回到對應對話；提醒時機可選「僅後台 / 僅目前對話靜默 / 總是提醒」。
- **人走開但視窗沒走**：視窗留在最前台、人卻離開座位，超過 3 分鐘沒有輸入也算離開，該提醒的照常提醒；收到的那條通知不會在你回來之前自己消失，一回到頁面（點工作列、Alt+Tab、點通知都算）就收起（想讓它在回到頁面後繼續留著，開啟「回到頁面也保留提醒」）。
- **離開電腦時**：可選轉發到 Discord、Bark、Gotify、飛書群機器人、Server酱、WxPusher、Telegram 或自己的 Webhook。
- **拿手機看 DSH Web 時**：Android Chrome 不支援頁面的 `new Notification()`（拋 `Illegal constructor`），插件自動改用頁面自帶的 Service Worker 發通知，點通知回對應對話；關掉快速裁決也照樣能收到。
- **四檔語言**：跟隨介面 / 簡體中文 / 繁體中文 / English——通知文字、`🔔 …` 標題標記與設定介面按同一檔切換（宿主本身沒有繁體語言包，這一檔由插件自帶）。
- **連頁面都關掉時**：可選讓宿主行程兜底——頁面不在時宿主繼續把「需要你操作」「回覆完成」推到你的閘道；也可以只開同源中繼，讓頁面夠到要認證的閘道。兩項預設關，設定寫在 profile 的 patch 層（見[頁面關閉後：宿主側兜底與同源中繼](#頁面關閉後宿主側兜底與同源中繼)）。

## 效果預覽

![Windows 上經 Edge 顯示的 DSH 普通通知，未包含核准按鈕](https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/screenshots/notify-toast.png)

*普通通知範例 · Windows / Edge · 不含核准按鈕。* [檢視原圖](https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/screenshots/notify-toast.png)

<details>
<summary>展開設定介面預覽</summary>

![通知提醒設定頁：頁首、提醒方式、什麼時候提醒、對話靜音、試一試與摺疊的進階設定](https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/screenshots/settings-zh-tw.png)

只截插件自己的面板（真實元件，與宿主同款深色主題），不帶 DSH 左側導航欄；每行說明在滑鼠停在標題文字上時才出現，所以這裡只看到標題。

</details>

> **macOS 桌面端（DSH Desktop）** 的系統通知由宿主拉起的小助手 `DSH Notify.app` 發出，需先執行一次 `bash macos/build.sh` 並在系統設定裡允許它發通知（見 [macOS 桌面端怎麼發系統通知](#macos-桌面端怎麼發系統通知)）。

> 頁面或桌面應用需保持執行（後台 / 最小化可以）；系統通知需要通知權限。核准按鈕在 Web 與 Windows 11 桌面端可用，macOS 桌面端、Windows 10 與沒有 Service Worker 的頁面點通知回對話裡裁決（見[提醒渠道](#提醒渠道)）。開啟宿主側兜底後，頁面關閉仍能收到外部推送——本地通知與核准按鈕仍要頁面在。

## 安裝

### DSH Web

已安裝 DSH CLI 的使用者，在終端機執行：

```sh
# 安裝並自動掛載進 web profile
dsh plugin --profile web add dsh-notify-me
```

重啟 `dsh web`，然後硬重新整理頁面（Windows / Linux 是 Ctrl+Shift+R，macOS 是 Cmd+Shift+R）。如果你使用其他 Web profile，請把命令中的 `web` 換成實際名稱。

### DSH Desktop

1. 在桌面應用開啟 **插件 → 新增插件**。
2. 輸入 npm 包名 `dsh-notify-me`，按應用提示完成安裝，並確認插件已啟用。
3. 完全退出並重新啟動 DSH Desktop，使插件載入。

桌面端的 `desktop` profile 由 Electron 應用管理；不要把上面的 Web 命令改成 `--profile desktop`，CLI 會拒絕此操作。安裝到 Web profile 也不會自動安裝到桌面端。

## 首次驗證

1. 在 DSH 頁面上點選一次，按提示允許通知；若此前拒絕過，在瀏覽器站點設定中允許通知。作業系統也需要允許對應瀏覽器 / DSH Desktop 顯示通知。
2. 開啟 **設定 → 通知提醒**，確認出現該區段及底部插件版本號，保持「啟用提醒」「提示音」開啟。
3. 點選設定頁的「測試『回覆完成』」按鈕：應出現一條測試通知，並按目前音效設定播放聲音。這個本地測試不會轉發到外部通知端點，也不受「視窗在前台時也提醒」開關限制。

Web 使用者可再測核准按鈕，通知上會帶「同意 / 拒絕」。Windows 11 桌面端由宿主發原生 Toast，同樣帶按鈕（Windows 10 不發出帶按鈕的原生通知，見[下文](#windows-桌面端怎麼發出帶按鈕的通知)）；macOS 桌面端只發普通通知（渠道差異見[提醒渠道](#提醒渠道)）。

<details>
<summary>控制台驗證（可選）</summary>

支援 DevTools 的環境也可執行：

```js
window.__dshNotifyMe.test("done")        // 「完成」範例
window.__dshNotifyMe.test("attention")   // 「需要你」範例
window.__dshNotifyMe.test("approval")    // Web 橋可用、或 Windows 桌面宿主原生 Toast 時帶「同意 / 拒絕」按鈕；macOS 桌面與無橋環境只發普通通知
window.__dshNotifyMe.debug()             // 橋接看 bridge（active = 按鈕可用）、抬窗通道 raiseChannel、最近一次嘗試 raiseLast、平臺拒發原文 lastToastReject、設定是否真存下來 configStored、宿主協調看 hostBridge、原生通道看 macNative / macNativeLast、winNative / winNativeLast；切回頁面後收通知看 toastsLive / toastsWithdrawn / lastToastWithdrawAt（還掛著幾條 / 累計收起幾條 / 最後一次的時間）
```

</details>

沒有測試通知時，先檢查：通知權限是否被拒絕（在頁面上點一下 → 選「允許」；或位址列鎖 → 站點設定 → 通知 → 允許 → 重新整理）、裝完沒重啟 DSH、系統設定裡瀏覽器通知被關。

要是**設定裡壓根沒有「通知提醒」這一欄**，控制台裡 `window.__dshNotifyMe` 也是 `undefined`，那是客戶端半身根本沒載入——1.21.4 及更早在部分宿主上會這樣，頁面不會有任何報錯（[#44](https://github.com/chromoany/dsh-notify-me/issues/44)）。把插件升到 1.21.6 以上再重啟 DSH 即可。

## 為什麼需要它

- **不開完整存取（`workspace-write` + ask）**：保留事前核准，但錯過請求會讓 agent 等待。
- **開完整存取（full access）**：減少核准打斷，同時放棄事前攔截能力。

dsh-notify-me 把「監督」和「守在螢幕前」解耦：只在真的出現決策點（核准 / 方案確認 / 提問）或回覆跑完時，才用系統通知把你叫回來——**讓你敢不開完整存取**，不必靠放棄攔截能力來換效率。它不降低 full access 本身的權限風險（它不是沙箱），只是減少 ask 模式下因錯過核准而產生的等待。

## 提醒時機

| 事件 | 預設行為 |
| --- | --- |
| 🔔 需要你操作 | 頁面可見也提醒；目前對話只留標題標記 |
| ✅ 回覆完成 | 頁面隱藏 / 後台時提醒（可選「僅目前對話靜默」或「總是提醒」） |

**需要你操作**包括核准請求、方案待確認（plan review）和提問（`ask_user_question`）。帶按鈕的快速裁決在 Web 與 Windows 11 桌面端可用（Windows 由宿主發原生 Toast），macOS 桌面端與沒有 Service Worker 的頁面點通知回到對話裡裁決（見[已知限制](#已知限制)）。

**回覆完成**也覆蓋後台對話；完成但還沒看時，標題帶 `✅ 回覆完成 ·` 標記，開啟對應對話即撤。標題標記不受提醒策略限制。

通知正文的第一行是對話標題：目前正在看的對話和其他對話一樣顯示自己的標題，只有宿主還沒給出標題的新對話才用「目前對話」佔位符兜底。

> **後台**子代理（subagent）對話的等待與完成預設**不提醒**：DSH 把每個子代理對話列成一條獨立對話，但它們是所屬主對話那一輪裡的步驟，提醒只會是噪音。你目前開啟的那個子代理對話不算在內，照常提醒。設定頁「子代理對話不提醒」可關掉這個靜音。

## 在 DSH 設定裡調整

開啟 **設定 → 通知提醒**。頁面按「提醒方式 → 什麼時候提醒 → 試一試」三段排開，不常改的收進底部「進階設定」，點一下展開。每行只寫標題，具體說明在滑鼠停在標題文字上時彈出的小方框裡（只有標題本身觸發佈局，整行空白處不會彈；觸控螢幕或鍵盤操作時留一份隱藏文本給螢幕閱讀器）。帶 ▸ 的行點一下展開子項。

### 提醒方式

- **啟用提醒** 總開關：關閉後不彈通知、不響提示音，也不改分頁標題；
- **提示音 / 音量**：開關直接切；音量滑桿收在該行裡，點一下標題（▸ 變成 ▾）展開。具體播什麼由「進階設定 → 音效來源」決定；
- **核准通知上直接裁決**（預設開）：核准帶「同意 / 拒絕」，點一下即完成裁決，不用切回頁面。Web 走帶按鈕的系統通知；Windows 11 桌面端由宿主發原生 Toast，按鈕是真的原生按鈕；Windows 10 的系統通知派發不了按鈕點選，核准仍在頁面或浮層裡裁決；macOS 桌面端 `dsh-app://` 註冊不了 Service Worker、原生助手也不帶按鈕，點通知回到對話裡裁決。設定頁「試一試」下面那行會如實說明目前環境能不能給按鈕。

### 什麼時候提醒

- **視窗在前台時也提醒「需要你」**（預設開）：關掉後只有視窗轉到後台才提醒；
- **前台也提醒（一鍵）**（預設關）：一次把下面三項調成「前台也提醒」——「視窗在前台時也提醒『需要你』」開啟、「目前對話不彈通知」關掉、「回覆完成」設為「總是提醒」。它不新增儲存鍵，只是那三項的派生檢視：三項任一被單獨改動，這一行會跟著變；關掉它恢復預設的「只在後台提醒」；
- **目前對話不彈通知**（預設開）：正看著的對話裡的等待只留分頁標記，人離開後照常補發；
- **「回覆完成」什麼時候提醒**（預設「僅後台」）：僅後台 / 僅目前對話靜默 / 總是提醒，三選一；
- **通知自動消失**（預設「離開時保留」）：離開時保留 / 總是關閉 / 從不關閉，三選一；三種設定只管「時間到點」那一次關閉，你回到頁面時殘留的通知一律收起；
- **回到頁面也保留提醒**（預設關）：開啟後，離開時收到的通知在你回到 DSH 頁面後不再被收起，會一直留到你點掉或點「關閉」——適合把系統通知樣式設成「持續」、希望提醒常駐螢幕的用法；
- **子代理對話不提醒**（預設開）：跳過後台子代理（subagent）對話，你正開著的那個照常提醒；
- **點選通知回到對應對話**（預設開）：切到對應對話並把視窗帶到前台，Windows 桌面走宿主路由原生抬窗、macOS / Linux 走 `dsh://open` 深鏈，多個分頁只調起一個。

<details>
<summary>展開各開關的邊界條件</summary>

- **後台的判定**：切到別的應用、被別的視窗蓋住、最小化都算；視窗一直留在前台但 3 分鐘沒有任何鍵鼠輸入同樣算，`idleMinutes: 0` 退回只看視窗。
- **「目前對話不彈通知」何時補發**：視窗轉到後台或閒置超時後照常提醒；若你已處理掉就作廢。
- **「回覆完成」三檔**：「僅後台」＝不在看頁面才提醒；「僅目前對話靜默」＝螢幕上那條靜默、別的對話照常提醒，多開對話時有用；「總是提醒」＝從不靜默。舊設定裡的「視窗在前台時也提醒『回覆完成』」開關自動遷移到這一項。
- **Goal 還在跑的時候不報「回覆完成」**：連續 Goal 的每一輪在宿主看來都是普通的一輪結束，但它只是中間步驟，下一輪馬上接著跑。這類輪次現在不提醒，等 Goal 真的停下（完成、暫停、阻塞）才報最後一條；取不到 Goal 狀態時（更老的宿主）照舊提醒。
- **「離開時保留」**：你人在頁面前時，普通通知幾秒後自己收；人不在時收到的那條留在通知中心等你回來。回到頁面（點工作列、Alt+Tab、點通知、還原最小化的視窗都算）就立刻收起，三種設定都不影響這一條——不看通知中心，也不會被遺留通知擋著。**開啟「回到頁面也保留提醒」後，回到頁面這一條也不再收起**，通知留到你點掉或點「關閉」，系統通知樣式設成「持續」時會一直掛在螢幕上。帶「同意 / 拒絕」的通知不設自動撤回，留到你點按鈕、回頁面把請求答掉、或被新請求頂替為止（僅 Web 端的 Service Worker 通知如此）；macOS 桌面端畫不出按鈕的核准通知、以及 Windows 11 桌面端帶按鈕的原生核准 Toast，都按 12 秒收。宿主發出的原生通知（Windows 原生 Toast、macOS 通知中心）同樣歸這套記賬管：人不在時同樣不撤，回到頁面同樣收起（該開關開啟時也保留），「總是關閉 / 從不關閉」也管得到它們。
- **點選通知的兜底**：桌面端抬不起來時只切對話，原因記在 `debug().raiseLast` 裡；關掉這一項後點通知不做任何事。

</details>

### 靜音某些對話

適合「後台跑著週期任務、但這次不用管它」的對話：只關掉那一行的提醒，別的照舊。

- **靜音**：滑鼠移到側邊欄的對話行上，右側出現鈴鐺，點一下即靜音（按鈕讀作「靜音此對話的提醒」）；再點一次恢復。也可以右鍵點對話，在選單裡選「靜音此對話的提醒」——觸控裝置沒有滑鼠移上條，選單裡這一行就是入口；
- **標記**：被靜音的對話在標題前顯示一個劃掉的鈴鐺（螢幕閱讀器讀作「此對話已靜音」）；
- **滑鼠移上鈴鐺可以關掉**：設定頁「對話靜音」卡片頂部的「滑鼠移上時顯示靜音按鈕」預設開；關掉後滑鼠移上不再出鈴鐺，未靜音的對話改用右鍵選單。已靜音的對話仍保留這枚鈴鐺——它既表示狀態，點一下就能取消靜音；標題前的劃掉鈴鐺不受影響；
- **範圍**：「需要你」「回覆完成」、提示音、分頁標記、外部推送一起關掉；別的對話完全不受影響；「試一試」裡的測試按鈕照發（它就是用來當場驗證渠道的）；
- **持久化**：列表存在本地，重新整理、重啟都在；手工改壞的設定會被剪掉而不是讓整頁失效；
- **關掉分頁之後**：靜音列表會隨心跳交給宿主，所以「頁面關閉後的宿主側兜底」也不會為它推送——否則關掉頁面反而開始響。

設定頁「什麼時候提醒」下面有一張「對話靜音」卡片，顯示目前靜音了幾個對話，滑鼠移上鈴鐺的開關就在卡片頂部，可以一鍵「全部取消靜音」。

<details>
<summary>邊界條件</summary>

- 標記注在宿主的 `sidebar.session.row.leading` 槽位，宿主在「這條對話有執行狀態」時用狀態點佔著這個位置，標記就不渲染——正在跑的後台任務看不到劃掉的鈴鐺，停下後自動回來。靜音本身不受影響，通知照舊不發。
- 右鍵選單裡那一行注在宿主舊的 `sidebar.workspaces.session.menu.item` 槽位，宿主不宣告這個槽位時只是選單裡少一行，滑鼠移上鈴鐺、設定頁和靜音本身都不受影響。
- 滑鼠移上鈴鐺關掉後，未靜音的對話在行上沒有任何靜音入口，判斷/取消靜音都走右鍵選單；已靜音的對話行尾仍保留按下狀態的鈴鐺。
- 靜音只看對話 id：重新命名、換目錄都不影響，刪掉的對話留在列表裡也不會報錯（列表上限 200 條，恢復按鈕隨時清空）。
- 靜音不改變「回覆完成」的 donePolicy 判定，也不改變「目前對話不彈通知」：兩者疊加時以靜音為準。

</details>

### 試一試

三個按鈕分別發一條「需要你」「回覆完成」「核准按鈕」測試提醒，用目前設定立即發，**不受**「什麼時候提醒」裡的開關限制；下方一行如實說明目前哪種渠道能給核准按鈕。

設定頁底部常顯插件版本號（`dsh-notify-me v…`）——報障、核對是否裝上新版本時直接照抄這一行。

### 進階設定

預設收起，點一下展開。裡面收著三塊不常改的東西：音效來源、外部推送、執行環境與診斷——分別見下面三節。

#### 音效

「需要你」與「回覆完成」可獨立選擇內建合成音（預設）、自定義音訊檔案或系統通知音。自定義音訊上限 1 MiB，存在瀏覽器本地，可試聽與移除；選系統通知音時完全不播插件音效，通知照發，聲音交給作業系統（音色跟著系統通知設定走），此時「試聽」會改發一條測試通知。任一來源缺檔案、讀不出來或存不下時回落到內建合成音，提醒不會變成啞的。

#### 外部推送

預設關閉。支援 Discord Webhook / Bark / Gotify / 飛書群機器人 / Server酱（Turbo 與 Server酱³）/ WxPusher / Telegram / 自定義 Webhook；提醒正文會發往你填寫的位址，只使用可信端點。

<details>
<summary>目標位址、轉發開關、傳送測試與失敗記錄</summary>

- **外部通知**（預設關）：把提醒同時轉發到你自己的推送端點，人不在電腦前也能收到；可加多個目標，每個目標可單獨啟停。「轉發「需要你」」「轉發「回覆完成」」各自獨立開關；**傳送測試通知**往所有目標發一條測試訊息（不受這兩類開關限制，也不會冒充真提醒）。轉發跟本地提醒走同一套觸發規則（「目前對話不彈通知」等開關同樣管它）；總開關關閉後**頁面關閉時的宿主側兜底也一併停**（開關隨心跳交給宿主，見「頁面關閉後」一節），不會出現「頁面關了還在推」；提醒正文會原樣發往你填的位址，**只填你自己信任的端點**；
- **各目標的填法**：Discord 填 Webhook 位址；Bark 填 `https://api.day.app/<裝置金鑰>`；Gotify 填 `https://<伺服器>/message?token=<應用權杖>`；飛書填群機器人 Webhook，可選填簽名校驗金鑰；Server酱 填 `…/send/<SendKey>.send` 完整位址；WxPusher 填 appToken 與接收者 UID；Telegram 填 `@BotFather` 給的機器人權杖，聊天 ID 填數字或公開頻道的 `@使用者名`（私聊要先給機器人發 `/start`，群組與頻道要把機器人拉進去併發訊息權限）；自定義端點收一條 POST JSON：`{source, event, title, body, text, sessionId, time}`；
- **可靠投遞**：明顯是臨時故障的失敗（網路中斷、5xx、429）按 2 秒 / 6 秒自動重試兩次，其它錯誤立即停；關掉「外部通知」總開關或刪掉某個目標後，已經排在定時器上的重試立刻作廢，既不算失敗也不進失敗記錄；重試仍失敗會把這一條記進「失敗記錄」（最多 10 條，只留標題與正文摘要和主機名，不留完整端點），設定頁能一眼看到並清空；
- **服務碼與「不可確認」**：飛書 / Server酱 / WxPusher 的 2xx 還會讀返回體裡的服務碼（飛書與 Server酱是 `0`，WxPusher 是 `1000`），碼不對按失敗記並帶服務端文案；Telegram 的 2xx 看 `ok`：為 `true` 記成功，為 `false` 時按 `error_code` 記失敗（`429` 與 `5xx` 屬可重試），`ok` 缺失或不是布林值記「已送出不可確認」。2xx 但正文不是該服務的 JSON（空白、代理或 WAF 的網頁）同樣記「已送出不可確認」，不冒充成功；
- **每個目標的狀態**：目標行右側顯示它最近一次投遞的結果（上次成功 / 上次已送出但不可確認 / 上次失敗 + 原因），並各自帶一個啟停開關——某個端點臨時不可用就單獨關掉它，不用關掉整類事件；
- **簽名**：自定義目標填了簽名金鑰時，請求帶 `X-DSH-Notify-Signature`（對請求體做 HMAC-SHA256，`sha256=<hex>`）；飛書填了簽名金鑰時按官方演算法在請求體裡帶 `timestamp` / `sign`；
- **訊息模板**（可選）：飛書 / Server酱 / WxPusher / Telegram / 自定義目標可填模板，佔位符 `{{title}}` `{{body}}` `{{event}}` `{{time}}` `{{session}}`，留空預設是「標題 + 換行 + 正文」；Telegram 單條上限 4096 字元，超出按這個上限截斷後接一個省略號（整條發不出去比截斷更糟）；
- **釘釘不在支援列表裡**：釘釘群機器人介面不返回任何 CORS 頭，且只接受 `application/json`——瀏覽器頁面既讀不到回應，也無法發出符合要求的請求（no-cors 下 Content-Type 會被限制成 safelisted 型別）。要用釘釘，請在自己能控制的機器上搭一箇中轉，再把「自定義 Webhook」指向它。

</details>

#### 執行環境與診斷

在「進階設定」最後一塊。預設自動識別目前是 Web 端還是桌面端（DSH Desktop，`dsh-app://`）；識別不準時可手動指定——Windows 桌面點通知走宿主路由做原生抬窗、macOS / Linux 走 `dsh://open` 深鏈（見[桌面端怎麼抬窗的](#桌面端怎麼抬窗的)）；抬窗通道本身不帶快速裁決按鈕——按鈕來自 Web 的 Service Worker 橋，或 Windows 11 桌面端的宿主原生 Toast。手動覆蓋與自動識別不一致時，設定頁會明示檢測結果。

<details>
<summary>通知語言、桌面端抬窗與恢復預設</summary>

- **介面與通知語言**：跟隨介面 / 簡體中文 / 繁體中文 / English——決定通知文字、`🔔 …` 標題標記與設定介面本身使用的語言；
- **桌面端抬窗**：Windows 走宿主路由做原生啟用、macOS / Linux 走 `dsh://open` 深鏈；最小化、被別的視窗蓋住的視窗在 Windows 與 Linux 上都實測能抬回來，Windows 上 `SW_HIDE` 到系統匣的視窗也會先 `SW_SHOW` 再抬（1.21.0 起，見[桌面端怎麼抬窗的](#桌面端怎麼抬窗的)）；
- **恢復預設設定**：把所有開關與音效設定還原成出廠值（不動外部推送目標和已選的自定義音訊檔案）。

</details>

## 頁面關閉後：宿主側兜底與同源中繼

這兩塊能力住在宿主行程裡（`lib/host-fallback.js`、`lib/relay.js`，都是包內的可選模組），預設關：沒有設定時宿主只註冊抬窗那一條路由，升級前後行為一致。它們的設定寫在 profile 的 patch 層，不在設定頁裡——它們讓宿主替頁面幹活，不是瀏覽器偏好；設定頁只如實顯示探測到的狀態。

<details>
<summary>宿主側兜底：頁面關閉後由宿主接著推</summary>

頁面不在時頁面半體不執行，提醒就斷在這裡。宿主側兜底訂閱宿主的對話事件流（`session/event`），在頁面關閉後自己把同樣兩條提醒發到你設定的閘道。它跟頁面共用同一組開關：心跳把 `external: {enabled, attention, done}` 報給宿主，頁面裡「轉發外部通知」總開關關掉（或只關掉「需要你」/「回覆完成」其中一類）時，兜底也照同樣規則閉嘴——否則關掉總開關、再關掉分頁，最後那條外部通知還是會到。

profile 覆蓋範例（`~/.dsh/profiles/<profile>/cordis.patch.yml`）。**`config` 是整塊替換、不是深合併**：patch 裡寫同一個 `id` 就把整個 `config` 賦過去，所以範例把三塊都寫全——漏寫的鍵會回落到插件內的預設值（與隨包 YAML 是同一份），但被一起沖掉的 `gateway.target` 不會自己回來。

```yaml
- id: notify-me
  config:
    allowedOrigins: []            # 頂層：頁面入口白名單，留空 = 只接受迴環 / 繫結位址（三條宿主入口共用）
    gateway:
      target: ''                  # 例：https://cue.example/notify/<key>
      credentialsFile: ''         # 0600 JSON，見下
      headers: {}                 # 額外請求頭，可選
    hostFallback:
      enabled: true
      target: ''                  # 留空 = 用 gateway.target
      credentialsFile: ''         # 留空 = 用 gateway.credentialsFile
      events: ['turn/end', 'approval/asked']
      includeSubagents: false
      turnEndThrottleMs: 15000
      titlePrefix: 'DSH'
      language: 'auto'            # auto | zh | zh-TW | en
      pageLeaseMs: 60000          # 0 = 不與頁面協調（頁面開著也會重複）
      healthPath: '/__dsh-notify-me/host-fallback'
    relay:
      enabled: false
      path: ''
      target: ''
      credentialsFile: ''
      bodyTemplate: ''            # 可選：JSON 請求體模板，見「同源中繼」
      snippetLimit: 3000          # 「回覆完成」補正文上限，0 = 不補（非 0 時 100..10000）
```

逐鍵說明（括號內是預設值）：

- `enabled`（`false`）：關著時宿主不訂閱任何事件，也不註冊健康探針；
- `target` / `credentialsFile`（空）：留空回落到 `gateway.*`；兩處都空等於沒地方可推，模組乾脆不掛載，只在宿主日誌裡留一行 warning——比每次投遞都失敗好查；
- `events`（`['turn/end', 'approval/asked']`）：要推的事件，只列一種就只有那一種；
- `includeSubagents`（`false`）：`origin === 'subagent'` 的對話預設跳過，理由與頁面側一致——它們是主對話一輪裡的步驟；
- `turnEndThrottleMs`（`15000`）：同一對話的「回覆完成」在這個視窗內只推一條；視窗只在真發出去時才消耗，被租約擋掉的那次不算。節流只管 `completed`——`aborted` / `error` / `max-tokens` 這些收尾不節流，它們本來就少，而且往往是此刻最該看到的那一條；
- **文案與頁面通知逐字一致**：標題是 `<字首> · 回覆完成` / `<字首> · 核准請求`，正文「回覆完成」只有對話名、「核准請求」是 `對話名：工具名 · 原因`——不含任何使用者訊息正文（使用者訊息裡常帶注入的 `<system-reminder>`、記憶上下文與時間戳，複製進通知就沒法讀了）；非正常收尾（`aborted` / `error` / `max-tokens`…）會在正文尾部附一個短後綴，如 `（error）`；
- `titlePrefix`（`DSH`）：標題是 `<字首> · 核准請求` / `<字首> · 回覆完成`（與頁面通知同一套標籤）；
- `language`（`auto`）：`auto` 用頁面最近一次心跳報的語言，沒有心跳才回落到中文；`zh` / `zh-TW` / `en` 強制；
- `pageLeaseMs`（`60000`）：頁面線上租約，見下面「去重」；
- `healthPath`（`/__dsh-notify-me/host-fallback`）：只讀健康探針的路徑。

**憑證檔案**：宿主使用者可讀的 0600 JSON，內容是 `{"user": "...", "password": "..."}`（按 HTTP Basic 發）或 `{"authorization": "Bearer ..."}`（原樣發；裸 token 會自動補上 `Bearer `）。它不能寫進 patch 層——那一層世界可讀、還會進 profile 目錄。不填這個鍵時請求不帶認證頭：很多 webhook 端點本來就不要認證，把「沒配憑證」當成錯誤會讓每個提醒都失敗；只有「配了路徑卻讀不出來」才算憑證不可用。閘道回 401 / 403 時宿主丟掉快取的憑證、重讀檔案、只重試一次，所以輪換密碼不需要重啟宿主。

**去重靠一條頁面線上租約**：頁面載入後 `GET /__dsh-notify-me/host-bridge` 探測一次（之後每 60 秒復探，頁面隱藏時不探、回到可見補探一次），只有回包 `hostFallback.enabled === true` 才開始心跳——body 是 `{alive, language, muted, external}`（`muted` 是被靜音對話的 id 列表，`external` 是 `{enabled, attention, done}` 三個轉發開關），間隔取 `leaseMs/3`、夾在 5–20 秒；改靜音列表或任一轉發開關時不等間隔，立刻補一次心跳；`pagehide` 時發一條 `{alive:false, language, external}`（帶 `keepalive`）立刻釋放。宿主側租約新鮮就不補推（頁面自己在推），租約過期或收到 `alive:false` 才接手，最多等 `pageLeaseMs` 這麼久。心跳帶語言、靜音列表與轉發開關：前三樣都是使用者親手寫進設定的確定狀態，宿主照它們執行就是頁面自己的意思——靜音列表決定哪些對話閉嘴，`external.enabled: false`（設定頁「轉發外部通知」關掉）則連宿主兜底一起停，否則關掉總開關、再關掉分頁，宿主照樣把剛被關掉的那條外部通知推出去；`attention` / `done` 分別管「需要你」「回覆完成」兩類。仍然不帶的是頁面的可見性與閒置判定：那是宿主看不見的啟發式，只照做一半會得到誰也算不清的規則。語言帶過來是為了英文頁面不收中文宿主提醒，`language: 'auto'` 時生效。`external` 只有三個欄位全是布林才被採納，缺欄位或型別不對保留上一次答案；頁面從沒報過（宿主剛起、頁面還沒開）時兜底照舊按 `hostFallback.enabled` 推。列表在心跳裡按位元組截斷（預算 8 KiB、最多 200 條）：被截掉的對話仍在本頁靜音，只是不由兜底接管。`pageLeaseMs: 0` 關掉協調，宿主永遠推——頁面開著時會收到兩份，只在除錯時用。

**兩個路由的契約**：頁面探測的那條 `GET /__dsh-notify-me/host-bridge` 回 `{ok, version, features, hostFallback:{enabled, leaseMs}, relay:{enabled, path, upstreamHost, upstreamPath}, language, page:{alive, ageMs}}`（`upstreamHost` / `upstreamPath` 是宿主替你轉發時的閘道主機名與路徑，只在中繼啟用時給出，憑證永不下發）；它只在 `hostFallback.enabled` 或 `relay.enabled` 為真時註冊，預設安裝下是 404，頁面按「未啟用」處理而不是當故障。心跳 `POST` 要求意圖頭 `x-dsh-notify-me-page: bridge`（缺了回 `403`），壞 JSON 回 `400`，body 超 16 KiB 回 `413`，成功回 `200 {ok, leaseUntil}`。

**健康探針**：`GET <healthPath>` 回 `{ok, version, enabled, events, includeSubagents, pageAlive, lastDelivery: {at, ok, status} | null}`，非 GET / HEAD 回 `405`。它和其它宿主入口共用同一道閘門：對端必須是本機（迴環或監聽器自己繫結的那個位址），`Host` 必須是迴環名 / 繫結位址 / `allowedOrigins` 派生的公網域名，不符回 `403` 並帶 `reason`（`bad-remote` / `bad-host` / `cross-origin`）。探針不收憑證、不轉發，用它在終端機確認「這個宿主行程到底有沒有在推、上一次投遞是什麼結果」。

**走隧道或反代時必須配 `allowedOrigins`**：那種部署下發往宿主的 `Host` 是公網域名而不是迴環位址，而 `allowedOrigins` 既是 `Origin` 白名單，也是可接受的 `Host` 來源。不寫它，頁面的心跳會被閘門判 `bad-host`（設定頁那行顯示「宿主未回應」，下方直接提示去頂層 `allowedOrigins` 補本頁來源），宿主於是把開著頁面的提醒也補推一遍——正是租約要避免的那種重複。

</details>

<details>
<summary>同源中繼：讓頁面夠到要認證的閘道</summary>

頁面用自己的 `fetch` 往外部目標推，碰上要 Basic 認證的閘道就是死路，三條 CORS 事實各堵一次：

1. 把憑證寫進 URL（`https://user:pass@host/…`）：`fetch` 直接拋錯，請求根本沒發出去；
2. 加 `Authorization` 頭：請求變成預檢，而 Apprise 這類閘道不回任何 `Access-Control-Allow-*`，預檢失敗；
3. 退到 `no-cors`：帶不了自定義頭，等於沒有認證。

於是頁面只能報「已送出不可確認」。同源中繼把這一段搬到宿主：頁面 POST 到與自己同源的路由，宿主補上憑證再打閘道，然後把閘道的真實狀態回給頁面。

啟用需要 `relay.enabled: true`、`relay.path`（必須是絕對路徑）、`relay.target`（留空回落到 `gateway.target`）和 `relay.credentialsFile`（留空回落到 `gateway.credentialsFile`）。路徑本身就是能力——知道它就能讓宿主替你發一條通知，價值等同口令，所以建議帶一段隨機 token：`/__dsh-notify-me/relay/<32 hex token>`。

`relay.bodyTemplate`（可選）給不接受 Apprise `{title, body, type}` 形狀的閘道用：寫一段 JSON 模板，宿主按模板渲染請求體。佔位符是 `{{title}}` `{{body}}` `{{text}}` `{{event}}` `{{time}}` `{{session}}`（取載荷裡的 `sessionId`）`{{source}}` `{{version}}`，要寫在 JSON 字串裡；代入的值先按 JSON 字串轉義，所以標題裡的引號、換行不會把模板弄壞，載荷裡沒有的欄位渲染成空串，模板裡沒寫的欄位不會出現在請求體裡。

模板在宿主啟動時就校驗：渲染結果不是 JSON 物件、或模板超過 16 KiB（按 UTF-8 位元組算），整條中繼不掛載，日誌裡留一行 warning 寫明原因，狀態回包與設定頁也顯示中繼未啟用——配錯一次就能看見，不用等每條提醒都回 500。渲染後的請求體另有 256 KiB 上限（模板可以重複佔位符放大體積），超了回 `500 {reason:'rendered-body-too-large'}` 且不傳送。不寫這個鍵時保持原來的 `{title, body, type:'info'}` 不變。

**「回覆完成」缺的正文由宿主補齊**：`0.1.6` 起的宿主把對話文字從 `SessionSnapshot` 裡移走了（快照只剩生命週期與控制狀態），頁面上的完成提醒於是只有對話名——`body` 是一行標題、`text` 是「標題 + 換行 + 對話名」，推到手機上就是一條「只有標題」的通知。中繼在渲染前用宿主自己的 `sessionQuery` 讀該對話日誌，倒掃最後一條 `assistant/message` 的 text block 補成正文，再交給模板；補上來的文字**保留換行**（markdown 的 `##` 標題、`- ` 清單只有行首還在才算結構），只壓掉三行以上空行與行尾空白。`relay.snippetLimit` 控制上限（預設 `3000` 字元；`0` 表示不補、只轉發頁面給的那行對話名，非 `0` 時夾在 `100`–`10000` 之間）。**從公網名字進來的請求不補**：`allowedOrigins` 裡列出的網域能過閘門，但這樣的請求只轉發頁面自己的載荷——載荷裡的 `sessionId` 能指向任意對話、路徑本身又是能力，按它去讀日誌等於把對話內容交給能打到這條路的人；所以隧道下打開自己的頁面只收到對話名，本機頁面照常拿正文。頁面已經給出多行正文（舊宿主帶摘要）時不覆蓋；只有 `event: 'done'` 這樣補，「需要你」的正文是頁面寫的、不是完成摘要；讀不到對話日誌或沒有該服務時原樣轉發，提醒本身照發。

例：把提醒推給自己的推送服務（下面以 MagicPush 風格介面為例，它要求 `channel_ids` + `title` + `content`，Bearer 權杖放在宿主的 0600 憑證檔案裡）：

```yaml
- id: notify-me
  config:
    relay:
      enabled: true
      path: '/__dsh-notify-me/relay/<32 hex token>'
      target: 'https://push.example.com/api/v1/notifications/send'
      credentialsFile: '/absolute/path/push-credentials.json'   # {"authorization":"Bearer fn_push_..."}
      bodyTemplate: '{"channel_ids":["<channel-id>"],"title":"{{title}}","content":"{{text}}"}'
```

YAML 的單引號裡模板原樣保留；頁面設定裡把「自定義 Webhook」的位址填成同一個 `target`，請求會自動摺疊到中繼路由，憑證仍只留在宿主。

用法：**設定 → 通知提醒 → 進階設定 → 外部推送** 裡多出兩行只讀狀態，「同源中繼」一行顯示 `已啟用 · 位址：<origin><relay.path>`；把那個絕對位址填進同頁「自定義 Webhook」目標的位址即可，頁面不必知道憑證。

不想改位址也行：**「自定義 Webhook」目標裡如果填的是中繼上游閘道本身的位址，傳送時會自動摺疊到中繼路由**。這類位址在瀏覽器裡註定失敗（上面三條 CORS 事實各堵一次，其中 `no-cors` 兜底還會被 Apprise 當成跨站請求直接 `403 Cross-site request rejected`），舊版把它記成 `unverified`——設定頁顯示「上次已送出（不可確認）」、測試按鈕報「已送出不可確認」，**而手機一聲不響**。摺疊之後請求走同源、憑證由宿主補，回執就是閘道的真實狀態。摺疊要同時滿足：目標型別是「自定義」、URL 主機名等於 `relay.upstreamHost`、路徑也等於 `relay.upstreamPath`、目標沒配簽名金鑰（簽名在頁面算，中繼帶不過去）、且目標不是本頁同源。主機名或路徑有一項對不上就原樣直送（一個閘道常按路徑分多個 notify key，只比主機名會把 A key 的提醒發到 B key 去），設定頁會在會被摺疊的目標下寫一行說明。

走隧道 / 反代時中繼要和橋接路由過同一道 `Host` 閘門：把頁面的公網來源寫進頂層 `allowedOrigins`，否則探針與 `POST` 都會被判 `bad-host`。

回包口徑（頁面據此把「已送出不可確認」變成可核對的狀態）：

- `GET` / `HEAD` `<relay.path>` → `200 {ok, route, version, enabled}`：只讀探針，不轉發、不帶憑證，但**和其它宿主入口走同一道閘門**——路徑本身就是能力，不設閘門的探針會把「猜對了」告訴猜的人；拿它確認「這個行程掛的是不是我配的那條路徑」；
- `POST` → 讀 body（上限 64 KiB）、要求是 JSON 物件，對映成閘道的 `{title, body, type:'info'}`（配了 `relay.bodyTemplate` 時改為按模板渲染出的 JSON 物件；頁面載荷裡的 `tag` 一律不透傳：Apprise 把 tag 當服務過濾，不匹配會回 424），附上 `gateway.headers` 與憑證；請求必須帶 `x-dsh-notify-me-relay: relay` 意圖頭，缺了回 `403 {reason:'missing-intent'}`——跨站表單發不出自定義頭，要發就得多一次預檢，而預檢在閘道這裡必然失敗；
- `200 {ok, upstreamStatus, upstreamBody}`（`upstreamBody` 最多 500 字元）＝轉發成功；上游非 2xx 回 `502`，同為這一形狀；
- `500 {reason}`：模板配錯（`invalid-body-template` / `template-too-large` / `rendered-body-too-large`）——前兩種正常在宿主啟動校驗時就攔下了，這裡只是執行期的兜底，且什麼都不發；
- `400`（壞 JSON 或空 body）、`413`（body 超限）、`405`（方法不對）、`403`（閘門拒絕或缺少意圖頭）、`503`（配了憑證檔案但讀不出來）、`502 {reason:'upstream-error'}`（上游異常或閘道回了 3xx——跳轉不跟，因為跟過去會把 body 和 `Authorization` 重放到別處）。

憑證只在宿主：頁面拿不到它，它也不會回顯在回應或日誌裡。`POST` 走與其它宿主入口同一道閘門，所以跨站頁面或 DNS rebinding 的偽造來源即使猜到路徑也會被拒。

</details>

## 提醒渠道

| 渠道 | 表現 |
| --- | --- |
| 系統通知 | 經瀏覽器進 Windows / macOS / Linux 的系統通知中心，點選回到對應對話；macOS 桌面端由宿主拉起 `DSH Notify.app` 發（見 [macOS 桌面端怎麼發系統通知](#macos-桌面端怎麼發系統通知)）；Windows 11 桌面端的核准提醒由宿主發原生 Toast，帶「同意 / 拒絕」按鈕（見 [Windows 桌面端怎麼發出帶按鈕的通知](#windows-桌面端怎麼發出帶按鈕的通知)）；Web 端可帶「同意 / 拒絕」 |
| 手機瀏覽器 | Android Chrome 不能 `new Notification()`（`Illegal constructor`），插件改用頁面自帶的 Service Worker 發通知，點一下回對應對話；`debug().bridge` 與 `debug().lastToastReject` 會說明是走了 Worker 還是被拒 |
| 提示音 | 預設 WebAudio 合成音，「需要你」與「完成」音型不同；可換自定義音訊，或交給系統通知音 |
| 分頁標題 | `🔔 需要你 · …` / `✅ 回覆完成 · …`（隨通知語言切換），開啟對應對話即消失；兩種標記可同時出現 |
| 外部推送（可選，預設關） | 把同一條提醒轉發到 Discord / Bark / Gotify / 飛書 / Server酱 / WxPusher / Telegram / 自定義 Webhook |
| 宿主側兜底（可選，預設關） | 頁面關閉後由宿主行程繼續把「需要你操作」「回覆完成」推到你的閘道；要 profile 設定與 0600 憑證檔案 |
| 同源中繼（可選，預設關） | 頁面 POST 到宿主同源路由，由宿主補憑證轉發給要認證的閘道，並回傳閘道真實狀態碼 |

本插件以**瀏覽器層**為主：本地通知、提示音、標題標記仍只在頁面開著時工作（最小化 / 後台即可——那正是它監聽的「離開」狀態）；開啟宿主側兜底後，外部推送在頁面關閉後由宿主行程接著發。手機瀏覽器同理：Android Chrome 的通知走 Service Worker，頁面關掉就不再發。

## 相容性

已逐版實測在 `0.1.1-rc.2` 到 `0.2.2-rc.5` 上真正啟用，含 npm `next` 渠道的 `0.2.2-rc.3` / `0.2.2-rc.4` / `0.2.2-rc.5`（判定標準：插件條目進啟動頁 `__DSH_BOOT__`、執行時服務依賴 `sessions` / `locale` / `slots` 解析通過、`/plugins/??dsh-notify-me/client.js` 返回含新程式碼的構建、設定裡出現「通知提醒」區段）。`0.2.2-rc.3` 這版在隔離宿主裡除了上述四條，還實測了設定區段渲染與「啟用提醒」開關往返、四條宿主路由的掛載，宿主日誌零告警；桌面端另有 [#41](https://github.com/chromoany/dsh-notify-me/issues/41) 的報告人在同一版本上驗過原生 Toast 與抬窗（1.21.3 只加了 Windows 10 的 build 判定，沒有碰宿主 API）。2026-11-19 又對當時的 `latest` `0.2.2-rc.5` 與前一版 `0.2.2-rc.4` 各跑了一輪隔離驗證：兩版都是 76 個啟動條目、插件在 index 65，清單 `dsh.client.inject` 自 1.21.6 起為空、載入器不再把別的插件包目前置條件（[#44](https://github.com/chromoany/dsh-notify-me/issues/44)），無頭 Edge 載入帶 token 的真實頁面後 `apply` 正常執行（`debug()` 報 `version: 1.21.5`、`uiSession: bound`，控制台零報錯；改完 #44 之後又在 `0.2.2-rc.5` 上用 1.21.6 複測一輪，同樣 `apply`、`uiSession: bound`、`hostEnv: web`），宿主側十項 API / 槽位與核准契約 `allowed-once` 全在，九套件 `npm test` 在宿主自帶的 cordis 4.1.0 上也全過。逐版適配記錄、宿主代際的形狀差異與兩個會靜默失效的坑，見 **[docs/compatibility.md](docs/compatibility.md)**。

## 控制台進階設定

設定頁是第一入口。想指令碼化批次改、恢復預設，或查外部通知目標的欄位，見 **[docs/console-config.md](docs/console-config.md)**——完整的設定鍵、`decide()` / `testExternal()` 介面、外部通知測試的開關邊界，以及自定義音效和 `debug().hostBridge` 的讀法都在那裡。

## 工作原理

提醒核心監聽對話狀態與待處理互動；核准裁決由頁面側完成，Windows 桌面抬窗走宿主路由加 Win32 原生啟用、macOS / Linux 走 `dsh://open` 深鏈。

<details>
<summary>展開事件來源與降級說明</summary>

提醒核心按宿主代際取源（對照表見 [docs/compatibility.md](docs/compatibility.md)），目前對話一律來自客戶端 `sessions` 服務：

- **目前對話** `SessionSnapshot`：`running` true→false = 回覆完成；
- **待辦互動**：`uiSession` 的 `sessionStatus`（`≥ 0.1.6`，逐對話 `pendingInteraction`）或 `pendingInteractions`（`0.1.2 .. 0.1.5`）出現新 key = 模型在等你，容器裡帶上核准工具名 / 理由、提問文本；舊宿主回落到控制器快照的 `pending[]`；
- **其它已列對話**摘要：`running` true→false（或舊宿主的 `completed` 邊沿）= 後台工作提醒。宿主的「完成未讀」級別標誌負責補漏與標題標記：`≥ 0.1.6` 用 `sessionStatus` 行的 `completionUnread`（後台對話完成即點亮、開啟該對話/再次開跑/對話消失即清零），舊宿主用列表行的 `completed` 提醒位（選中對話即清零）；頁面沒看見的完成邊沿（插件熱過載中途、快照合併跳變）由此補報一次，邊沿與級別標誌同來時按短時間窗合併，只響一聲。
- **子代理對話**：列表行帶 `origin: 'subagent'`（並有 `parentId`）的**後台**對話預設靜音；你正開啟著的那個子代理對話不算靜音物件，它的提醒走目前對話的常規規則（頁面可見時預設只留標題標記、轉後台補發），切進來時積壓的等待同樣補上，切走後重新靜音。只有 `parentId`、沒有 `origin` 的分支（fork）對話屬於你自己的對話，始終照常提醒。

提醒核心仍然零第三方執行時依賴、完全自包含：通知文字按所選語言（跟隨介面 / 簡體中文 / 繁體中文 / English）即時解析。設定頁是**可選**的 React 呈現層——當 DSH web profile 提供 `slots` / `locale` / `react` 時才註冊進「設定 → 通知提醒」，缺任一能力時插件自動降級為純提醒（無設定頁），不影響功能。

</details>

### 快速裁決怎麼走通的

Web 端帶「同意 / 拒絕」按鈕的通知只能由 Service Worker 彈出（往 `new Notification()` 裡傳 `actions` 會直接拋 `TypeError`），所以 bundle 的同一份檔案再註冊成一個只幹轉信的 worker，把「點了哪個按鈕」帶回頁面；Windows 11 桌面端改由宿主發原生 Toast，按鈕同樣是「同意 / 拒絕」。**裁決仍在頁面裡發生**，調的是核准面板裡「允許一次 / 拒絕」用的同一個 `PendingApproval.answer('allowed-once' | 'rejected')`——「同意」就是「允許一次」，不多放行任何東西。

<details>
<summary>展開按鈕通知的記賬與調視窗</summary>

每條按鈕通知按互動 key 記賬，一次只認領一條等待；請求被頁面裡答掉、或被新請求頂替之後，殘留通知上的按鈕再點也不會誤裁，只是安靜地關掉。Web 端帶按鈕的通知不設自動撤回，等你點按鈕或把請求答掉才消失；普通通知 5 秒自收，macOS 桌面端沒有按鈕的核准通知與 Windows 11 桌面端帶按鈕的原生核准 Toast 都 12 秒自收。「通知自動消失」選「從不關閉」時，這兩類都不因到點而收；三種設定都只管定時器那一次關閉，你回到頁面時殘留的通知一律收起（「回到頁面也保留提醒」開啟時不收起）。沒來得及點就回頁面裡裁決，對話裡的核准一直等著你。

點正文的「調視窗 + 切對話」也歸 worker 這半側排程：`client.focus()` 只調起一個視窗（優先目前可見的），也只讓那個視窗切對話——多個 DSH 分頁不會互相搶焦點或一起亂切。

</details>

### 桌面端怎麼抬窗的

DSH Desktop 是一層 Electron 殼，頁面跑在 `dsh-app://app` 下：DOM 的 `window.focus()` 只動瀏覽器視窗物件、碰不到原生視窗，殼的 `will-navigate` 又把頁面裡發 `dsh:` 的常規出口堵上了。插件按平臺走兩條通道：Windows 走插件自己的宿主路由——頁面 POST `/__dsh-notify-me/focus-window`，宿主起 `powershell.exe` 跑 `lib/focus-window.ps1`，由它列舉原生視窗、自適應啟用；macOS / Linux 走殼自己的 `dsh://open` 深鏈——頁面在點選手勢裡插一個隱藏 iframe 導航 `dsh://open`（子框架導航不經過殼的頂層 `will-navigate` 攔截），交給系統協議註冊，殼的 `second-instance` / `open-url` 處理器據此 restore + show + focus 主視窗。Windows 上這條深鏈在 `0.2.1-rc.2` 複測 3/3 無效，1.14.0 起改走宿主路由；Linux（Plasma 6.8 / Wayland）已實測能把最小化或後台的視窗抬回前台，macOS 未實測。

<details>
<summary>展開路由、啟用順序、實測資料與安全閘門</summary>

Windows 的宿主路由：殼把 `dsh-app://app` 下除靜態資源以外的所有路徑原樣轉發給宿主 HTTP server（帶 origin 校驗、注入宿主 cookie），所以上面那個 POST 是同源請求，沒有 CORS 問題；宿主半（`lib/index.js`）本來就跑在 Electron 主行程的子行程裡，`process.ppid` 就是主視窗所屬的瀏覽器行程。點通知時：頁面 POST → 宿主起一次 `powershell.exe` 跑 `lib/focus-window.ps1 -ProcessId <ppid>` → 指令碼列舉該 pid 下無 owner、非 toolwindow 的頂層視窗（可見的優先；被 `SW_HIDE` 藏到系統匣的 DSH 主窗也保留，優先於同行程的可見輔助視窗，選中後先 `ShowWindow(SW_SHOW)`）→ 自適應啟用 → 比對 `GetForegroundWindow()` 列印 `FOCUSED=1|0` → 宿主回 `200` / `202`。

Windows 的啟用順序是實的：已經在前台就什麼都不做（最常見的情況，零閃爍）；最小化了先 `SW_RESTORE`；然後合成一次 ALT 按鍵（`keybd_event` 按下抬起）給本執行緒前台權限，再 `SetForegroundWindow`；全程都被前台鎖拒掉時，最後做一次**不搶焦點的置頂脈衝**——`SetWindowPos(HWND_TOPMOST)` 亮 120 ms 再落回 `HWND_NOTOPMOST`，視窗停在普通層的最上面、鍵鼠焦點原地不動（1.21.4 起）。不再用 `SW_MINIMIZE` + `SW_RESTORE` 兜底：那一對只把視窗「顯示」出來，Windows 按它記住的位置放回——被壓在底下時還是底下——所以每次重試都更低（[#42](https://github.com/chromoany/dsh-notify-me/issues/42)）。單獨調 `SetForegroundWindow` 會被前台鎖直接拒，按呼叫算、跟 `ForegroundLockTimeout` 無關；這也重新解釋了 1.5.2 那套深鏈「時靈時不靈」——能抬起來的那些次，多半是系統在通知被點選時自己啟用了應用。

實測（`powershell.exe` 5.1，同一輪跑完）：視窗在前台 ×3、最小化 + 記事本在前台 ×3、可見但被蓋住 ×3，全部 `FOCUSED=1` 且前台視窗比對一致，最小化那幾個的 `IsIconic` 都從 `true` 變回 `false`；記事本最大化完全遮擋、最小化 + 完全遮擋、`-ProcessId 0` 自動探測同樣成功。指令碼內部耗時最壞 434 ms，行程啟動到退出最壞 782 ms，都在 8 秒上限內；`pwsh` 7.6 對照一輪行為一致，只是 `Add-Type` 編譯慢約 100 ms（指令碼刻意不用 7 的語法）。不存在的 pid、存在但沒有可見視窗的 pid 都穩定 `FOCUSED=0` 並 `exit 0`。

置頂脈衝另做了一輪跨行程實測（Windows 11 26200，目標視窗屬於另一個行程、被最大化視窗整個蓋住）：直接對目標窗 `SetWindowPos(HWND_TOP, SWP_NOACTIVATE)` 返回 `True` 但 z-order 一點沒動，`BringWindowToTop` 同樣無效——跨行程的普通層抬窗會被忽略；換成 `HWND_TOPMOST` 立刻到第 0 位，120 ms 後 `HWND_NOTOPMOST` 仍留在第 0 位，前台視窗始終沒變。這也是兜底只能走置頂脈衝、不能只寫一句 `HWND_TOP` 的原因。

安全上只開一條 exact 路由。詞表之外的請求一律拒：非 GET / HEAD / POST 回 `405`（包括預檢的 `OPTIONS`，且從不回任何 CORS 頭），非 Windows 宿主（Web 版、macOS / Linux、純 Node）回 `501`（macOS / Linux 走深鏈，不經過這條路由），缺 `x-dsh-notify-me-focus: focus` 頭回 `403`。

那個頭只是「這是頁面發來的」標記，不是防線——DNS rebinding 的惡意頁對目標位址而言是同源的，能帶任意自定義頭、也不觸發預檢。真正的閘門是三層：對端位址必須是 loopback，或恰好是監聽器自己繫結的那個 IP；`Host` 必須是 loopback 名（`127.0.0.1` / `localhost` / `[::1]`，可帶埠）或同一個繫結位址，因為殼轉發時 `host` 已被刪掉、由 fetch 按它撥號的 URL 重填，而 rebinding 的頁面 Host 仍是攻擊者域名；帶了 `Origin` 就必須和 `Host` 同源。任一條不符回 `403`，`reason` 分別是 `bad-remote` / `bad-host` / `cross-origin`。`GET` 只回 `{ok, route, enabled, desktop, platform}`，裝完可以先用瀏覽器開啟確認路由在不在。400 毫秒內的重複呼叫合併成一次，指令碼超過 8 秒沒回話就 kill 掉按失敗處理。

這六條宿主路由（focus、macOS 通知、Windows Toast、頁面橋接、host-fallback 健康探針、同源中繼）現在還共用一層 DSH 准入：宿主若提供 `connection` 服務，handler 會先調 `connection.requestRejection(req)`——DSH 自己的路由也走這裡，包含 Host / Origin 圍欄和瀏覽器登入態校驗；它返回 401 / 403 就原樣轉發（`reason` 為 `unauthenticated` / `untrusted`），通過後才輪到上面這套插件自己的閘門。宿主沒有這個服務（舊版 DSH、純 Node、離線測試）時跳過前者、退回插件閘門，行為與之前相同。這一層收在 `lib/page-bridge.js` 的 `guardRequest()` 裡。

抬不起來的幾種場合與[已知限制](#已知限制)裡列的一致（提權視窗、另一虛擬桌面、前台被反覆搶走），一律如實回 `202`、對話照常切。`SW_HIDE` 到系統匣的隱藏主窗原來直接回 `202`，1.21.0 起先 `SW_SHOW` 再走同一套啟用步驟（[#40](https://github.com/chromoany/dsh-notify-me/issues/40)）。

</details>

### macOS 桌面端怎麼發系統通知

頁面裡的 `new Notification()` 在 macOS 的 DSH Desktop（`dsh-app://app`）上進不了通知中心——不彈，也不報錯（`Notification.permission` 照樣是 `granted`）。插件在這一平臺上改走宿主：頁面 POST `/__dsh-notify-me/mac-notify`，宿主（`lib/mac-notify.js`）拉起 `macos/` 下的小助手 `DSH Notify.app`，由它用 `UNUserNotificationCenter` 發一條真正的系統通知。

- **一次性準備**：`bash macos/build.sh` 編譯出 `macos/DSH Notify.app`（需要 Xcode Command Line Tools，幾秒鐘）。產物在 `.gitignore` 裡，不進倉庫也不進 npm 包。首次彈通知時在「系統設定 → 通知 → DSH Notify」裡允許。
- **走哪條路是自動的**：宿主只在「macOS + 桌面殼（Electron 二進位檔）+ 助手已編譯」三個條件都滿足時註冊這條路由；任一不滿足，`GET` 探測報 `enabled: false`，頁面繼續用自己原來的通知，行為與改動前一致。`dsh web`（瀏覽器）永遠走不到這條路由。
- **點通知回到對應對話**：小助手把對話 id 寫進臨時目錄的 `dsh-notify-me-click.json` 並開啟 `dsh://open` 抬窗；頁面重新獲得焦點時 `GET` 一次取走這個 id、切到對應對話，取走後即清掉，不會重複跳轉。DSH 本來就處於前台時 `dsh://open` 不產生新的啟用，頁面收不到 `focus`，所以通知掛出後、頁面在前台時還會每秒探測一次宿主（最多 120 秒），點選後 1 秒內完成切換，讀到點選即停；視窗不在前台時不輪詢。`autoFocus` 關掉時只抬窗不切對話。
- **提示音**：設定裡選「系統通知音」時交給 macOS，其餘音效模式仍由頁面自己合成，不會兩聲疊在一起。
- **標題、副標題、正文三段都用上**：通知正文的第一行是對話名，「回覆完成」這類沒有摘要的提醒以前正文就只剩這一行，讀起來像只告訴你「Main」。現在對話名放副標題（`--subtitle`，畫在標題和正文之間），正文放回復摘要：沒有摘要的提醒由主機的 `ctx.sessionQuery` 讀回對話日誌，取最後一條 assistant 訊息的開頭（80 字元，壓成一行）。讀不到就留空，提醒照發。帶摘要的提醒把對話名升為副標題、摘要留在正文。核准提醒本來是一行「對話名 + 內容」，原樣不動——拆開只會把內容弄丟。拆分放在 `lib/mac-notify.js`（`splitNotificationBody()`），摘要在同一處（`lastReplySnippet()`），小助手只負責畫，因此這兩條邏輯在任何平臺都能測。
- **通知上仍然沒有「同意 / 拒絕」按鈕**：macOS 的通知動作要求註冊通知類別，助手不碰核准狀態，裁決仍在對話裡做。
- **關掉它**：在 profile 的 patch 層給 `notify-me` 加 `macNotify: { enabled: false }`；或刪掉 `macos/DSH Notify.app`，路由會退回 `enabled: false`。

與抬窗路由一樣，這條路由只開一個 exact 路徑，其餘一律拒：非 GET / POST 回 `405`（含從不回 CORS 頭的預檢 `OPTIONS`），非 loopback 或未放行的 `Host` / `Origin` 回 `403`，POST 缺 `x-dsh-notify-me-mac: notify` 頭回 `403`，助手不存在回 `501`，請求體不是合法通知回 `400`。回應裡不含系統資訊，只回報助手的退出狀態。

### Windows 桌面端怎麼發出帶按鈕的通知

頁面裡的 `new Notification()` 在 Windows 桌面端不會被拒，但它帶不了按鈕：Electron 的渲染行程收到通知請求後只把 title / body / tag / icon / silent 抄給平臺，`actions` 陣列整個丟掉（`shell/browser/notifications/platform_notification_service.cc` 的 `DisplayNotification()`）；`dsh-app://` 頁面又註冊不了 Service Worker，而按鈕通知只有 Service Worker 才畫得出來。於是插件把核准提醒改由宿主發原生 Toast。**Windows 10 是例外**：那邊的系統通知派發不了協議啟用，1.21.3 起不再走這條通道，核准提醒留在頁面或浮層裡（原因見下）。

- **誰去彈**：宿主半（`lib/index.js`）註冊 `POST /__dsh-notify-me/win-toast`，由它起一次 `powershell.exe` 跑 `lib/win-toast.ps1`，用 WinRT `ToastNotificationManager` 把通知發到插件自己的 AUMID `dsh-notify-me` 下，走同一套系統通知設定。**不能借 DSH 的 AUMID**：那個 AUMID 掛著 COM Toast 啟用器，Windows 會把每次點選都交給 DSH 本體，Toast 上的協議按鈕永遠等不到派發（[#41](https://github.com/chromoany/dsh-notify-me/issues/41)，1.21.2 修）。
- **按鈕怎麼裁決**：Toast 的兩個按鈕是 `activationType="protocol"`，分別指向 `dsh-notify-me://approve?token=…` / reject。點按鈕後系統調起註冊在這個協議下的處理器（一個寫入動作檔案、再開啟 `dsh://open` 的 VBS），宿主在頁面下一次探針時把動作交回頁面；頁面仍走核准面板裡同一個 `decidePending()`——「同意」就是「允許一次」，不多放行任何東西。這條鏈路要求 Toast 掛在自己的 AUMID 下，否則點選會被別的應用的啟用器截走。
- **點正文也會抬窗**：正文點選統一走 `dsh-notify-me://open`（有對話時帶 `?session=`，沒有對話也保留為一次純抬窗），不再把 `dsh://open` 當 Windows 抬窗手段——那條深鏈拉不起最小化視窗，更拉不起 `SW_HIDE` 到系統匣的視窗。等待核准期間頁面每 1.5 秒取一次動作，取到 `open` 先 POST 宿主 focus 路由抬窗、再切對話；系統匣隱藏的視窗由 `focus-window.ps1` 先 `SW_SHOW` 再啟用（[#40](https://github.com/chromoany/dsh-notify-me/issues/40)）。
- **中文使用者名等非 ASCII profile**：處理器指令碼按 UTF-16LE + BOM 寫盤，動作目錄在點選時才用 `sh.ExpandEnvironmentStrings("%LOCALAPPDATA%")` 解析——指令碼正文因此全是 ASCII，不會再被 WSH 按系統 ANSI 內碼表解碼後把路徑弄亂（此前每次點按鈕都彈 `800A004C` 指令碼錯誤，[#36](https://github.com/chromoany/dsh-notify-me/issues/36)），1.20.1 起修復。升級後重啟桌面端即可，第一次發出帶按鈕的 Toast 時會重寫這份指令碼，不用手動清舊檔案。
- **註冊**：第一次發 Toast 前寫 `HKCU\Software\Classes\AppUserModelId\dsh-notify-me`（`DisplayName` = 通知抬頭，`CustomActivator` = 一個 CLSID），CLSID 只建空的存根、不註冊 `LocalServer32`——未打包應用不實現 COM 啟用器時，Windows 才會按 XML 把 `activationType="protocol"` 的點選派發出去；隨後按 tag 記賬到 `ToastNotificationManager.History`。兩者都是目前使用者級，不需要管理員權限。token 單次、3 分鐘有效；動作檔案被取走後即刪。
- **Windows 10 沒有按鈕**：Windows 10（build < 22000）缺 Windows 11 那條「沒有 COM 啟用器也照 XML 派發協議啟用」的實現——修復只落在 18967 之後的預覽分支，沒進 19041 / 19045 的服務分支（[microsoft-ui-xaml#1939](https://github.com/microsoft/microsoft-ui-xaml/issues/1939)）。19045 上實測：自帶 AUMID + 空存根 + 開始選單快捷方式都補齊，點按鈕、點正文仍然只把通知收掉（[#41](https://github.com/chromoany/dsh-notify-me/issues/41)）。所以 1.21.3 起在 build < 22000 上不發原生 Toast：路由回 `enabled: false`、`reason: "windows-10"`，核准提醒回到頁面自己的通知與浮層——寧可沒有按鈕，也不給一個按下去沒反應的。
- **不彈的場合**：非 Windows 桌面宿主、`winToast.enabled: false`、`powershell.exe` 不存在（`reason` 分別是 `disabled` / `helper-missing`），或 Windows 10（見上一條），路由報 `enabled: false`（`501`），頁面繼續用自己那條不帶按鈕的通知，行為與改動前一致。
- **關掉它**：在 profile 的 patch 層給 `notify-me` 加 `winToast: { enabled: false }`，核准提醒回到頁面自己的通知（無按鈕）。
- **自動消失與收起**：原生 Toast 歸 `trackToast()` 記賬，普通通知 5 秒、帶按鈕的核准 12 秒（「總是關閉 / 從不關閉」照舊），回到頁面（`keepOnReturn` 關閉時）同樣收起。

路由只開一個 exact 路徑，其餘一律拒：非 GET / POST 回 `405`，非 loopback 或未放行的 `Host` / `Origin` 回 `403`，POST 缺 `x-dsh-notify-me-win: toast` 頭回 `403`，請求體不合法回 `400`。回應只回報投遞狀態，不含系統資訊。

## 已知限制

**執行前提**

- 預設只在頁面開著時提醒（後台標籤 / 最小化可以，關分頁即失效——瀏覽器層方案固有限制）。開啟宿主側兜底後，頁面關閉仍能收到**外部推送**：它要 profile 裡 `hostFallback.enabled: true`、`gateway.target`（或 `hostFallback.target`）與一個 0600 憑證檔案，而且宿主行程自己在跑。
- 通知經由瀏覽器彈出，需允許瀏覽器通知權限；每次頁面載入後第一次出聲 / 彈通知前要先在頁面上點過一下；未授權時只剩提示音與標題標記。
- 系統通知橫幅只畫在主螢幕：Windows 沒有設定項、Chromium 沒有 API 能把它指到別的顯示器（多屏時副螢幕收不到）。要跨屏只能靠外部推送轉到手機（1.12.0 起頁面裡不再畫核准卡片）。
- 設定存在瀏覽器 `localStorage`：換瀏覽器 / 裝置或清除站點資料後回到預設值（設定頁可一鍵恢復預設）。

**平臺差異**

- 快速裁決按鈕要 Service Worker：`http://127.0.0.1`、`https` 可用，`http://192.168.x.x` 這類區域網路位址不行；**桌面端（`dsh-app://`）已實測無法註冊 Service Worker**（宿主未開放 `allowServiceWorkers` 特權）。因此 Windows 11 桌面端的核准按鈕改由宿主發原生 Toast（見 [Windows 桌面端怎麼發出帶按鈕的通知](#windows-桌面端怎麼發出帶按鈕的通知)），macOS 桌面端仍無按鈕、點通知回對話裁決。宿主不渲染通知按鈕時，`debug()` 的 `bridge` 欄位會說明原因，其餘功能不受影響。
- **Windows 10 沒有原生核准按鈕**：Windows 10（build < 22000）的系統通知不派發 `activationType="protocol"` 的點選，插件在那邊不發出帶按鈕的原生 Toast（路由 `reason` 報 `windows-10`），核准仍在頁面或浮層裡裁決（[#41](https://github.com/chromoany/dsh-notify-me/issues/41)，1.21.3 起）。
- Windows 的系統通知標籤上限 64 字元，而 Chromium 交給平臺的是 `n#<origin>#<tag>` 整串——桌面頁面 `dsh-app://app` 一項就佔去 16 個。插件按目前 `location.origin` 算剩餘預算，超長時保留可讀字首、尾部換成短雜湊，所以 `debug()` 裡看到的標籤可能被截短；平臺仍然拒發時，原文記在 `debug().lastToastReject`，設定頁的測試按鈕也會如實報出來，不再「提示已傳送但什麼都沒彈」。
- 桌面端（Windows）點通知後視窗仍可能抬不起來：目標視窗屬於更高完整性級別（提權 / UAC）、在另一個虛擬桌面、或前台被別的行程反覆搶回去時，宿主腳本回 `FOCUSED=0`、路由回 `202`，對話照常切（詳見[桌面端怎麼抬窗的](#桌面端怎麼抬窗的)）。`SW_HIDE` 到系統匣的隱藏視窗 1.21.0 起先 `SW_SHOW` 再抬，不再屬於這一條（[#40](https://github.com/chromoany/dsh-notify-me/issues/40)）。
- 桌面端（macOS / Linux）點通知依賴 `dsh://open` 深鏈：系統未註冊 `x-scheme-handler/dsh`、或外殼沒有 `second-instance` / `open-url` 處理時抬不起來；Linux 上已實測正常，macOS 未實測。
- macOS 桌面端：頁面自帶的 `new Notification()` 進不了通知中心（`Notification.permission` 報 `granted` 卻什麼也不彈），所以插件改由宿主拉起助手發通知，需要先 `bash macos/build.sh`（見 [macOS 桌面端怎麼發系統通知](#macos-桌面端怎麼發系統通知)）。助手未編譯時退回原行為，即桌面端彈不出系統通知。核准按鈕在 macOS 桌面宿主上仍然不渲染；Windows 11 桌面端改由宿主發原生 Toast，按鈕可用（見 [Windows 桌面端怎麼發出帶按鈕的通知](#windows-桌面端怎麼發出帶按鈕的通知)）。
- Android Chrome 只允許安全上下文註冊 Service Worker（`https` 或 `http://localhost`）；用 `http://192.168.x.x` 開啟時通知發不出，只剩提示音與標題標記，`debug().bridge` / `debug().lastToastReject` 會寫明原因。關掉快速裁決不影響這條退路——普通通知與核准通知都會自己註冊那個 Service Worker。
- 「繁體中文」這一檔是插件自帶的（宿主語言包只有簡體中文與 English）：它只管本插件的通知文字、標題標記與設定介面，宿主其餘介面仍按宿主自己的語言顯示。`auto` 下 `zh-TW` / `zh-HK` / `zh-MO` / `zh-Hant` 這類標籤都按繁體處理。

**提醒內容與時機**

- `≥ 0.1.6`（含 `0.2.0-rc.2`、`0.2.1-rc.2`）的宿主快照不再提供 `nodes`，所以頁面側拿不到回覆摘要；這類提醒的正文改由主機從 `ctx.sessionQuery` 讀對話日誌補上（最後一條 assistant 訊息開頭 80 字元）。若該宿主沒有 `sessionQuery` 服務，正文留空，提醒仍照常觸發。
- 標題標記由宿主與插件共同寫 `document.title`：宿主重算標題時標記可能被覆蓋，直到下一次提醒事件重新寫成。
- 「目前對話不彈通知」按「視窗是否在前台」判定：被別的應用蓋住、切到別的應用、最小化都算後台；回到前台或重新有鍵鼠輸入後恢復靜默。
- 按對話靜音的標記注在宿主的 `sidebar.session.row.leading` 槽位，而宿主在「這條對話有執行狀態」時用狀態點佔著這個位置，標記就不渲染——正在跑的後台任務看不到劃掉的鈴鐺，停下後自動回來；靜音本身不受影響。

**外部推送**

- 受瀏覽器跨域（CORS）限制：端點不放行時自動降級為「送出但不可確認」（no-cors），如實標為「已送出不可確認」；Discord、飛書、Server酱、WxPusher、Telegram 放行跨域（Telegram 回 `Access-Control-Allow-Origin: *`），可直接確認送達。釘釘不放行任何 CORS 頭、又只收 `application/json`，頁面發不出去，所以沒有做成目標型別（自建中轉 + 自定義目標才行）。臨時失敗（網路中斷、5xx、429）按退避重試，重試仍失敗進失敗記錄，其餘錯誤立即停、不重試；轉發在本地提醒決定要發之後才觸發，所以被靜音的提醒也不會外發。
- 同源中繼補的是兩件頁面做不到的事：「頁面夠不到要認證的閘道」，以及「回覆完成」缺正文。前者由頁面 POST 到同源路由、宿主補憑證並回傳閘道真實狀態碼；後者由宿主用 `sessionId` 讀該對話日誌，把最後一條回覆補成正文再推給你的閘道。第二件會把對話內容送出去：只有本機或監聽位址來的請求才讀，`relay.snippetLimit` 設 `0` 可關掉，從公網名字進來的請求過了閘門也只轉發頁面自己的載荷。仍然成立的邊界有幾條——中繼與宿主側兜底都要求宿主行程在執行（`dsh web` 或桌面端主行程），它們不是獨立守護行程，宿主退出就都停；宿主跑在代理環境裡時閘道域名要進 `no_proxy`，否則投遞會繞到代理出去；兜底只補外部推送，本地系統通知、提示音、標題標記與核准按鈕仍要頁面在；`pageLeaseMs: 0` 是除錯開關，頁面開著也會收到兩份；中繼路由路徑等同於口令，別讓它出現在公開記錄裡。

**設定頁圖示補丁**

- 左側導航行圖示靠 DOM 補丁：外殼按區段 id 硬編碼圖示且 `settings.section` 沒有圖示欄位，插件只能在面板渲染後把那一行的 `<svg>` 換成鈴鐺。命中依賴宿主目前的面板結構（`data-shortcut-modal="settings"` + 導航按鈕裡的標籤 `<span>`），DSH 改了這套結構就會靜默回落到預設齒輪，其餘功能不受影響。標誌與命名的取捨見 [docs/brand/README.md](docs/brand/README.md)。

## 開發自檢

```sh
node --check lib/client.js
node --check lib/index.js
npm test                         # smoke-test（狀態機）+ host-route-test（宿主半路由）+ page-bridge-test + host-fallback-test + relay-route-test + cordis-host-test + mac-notify-test + mac-notify-content-test + win-toast-test
npm pack --dry-run               # 預覽釋出包
```

<details>
<summary>各測試套件覆蓋範圍與手動檢查</summary>

`smoke/smoke-test.cjs` 是離線狀態機測試：三代宿主 + 主開關 + 語言四檔用例 + 快速裁決橋（Service Worker 半側一併跑）+ 閒置判定與通知自收 + 回到頁面即收起殘留通知 + 通知標籤長度收口 + 頁面側 host-bridge 探測/心跳/釋放與 `debug().hostBridge` 形狀 + 外部推送（含 Telegram 的報文形狀、`ok` / `error_code` 判決、429 與 5xx 重試、4096 截斷、半設定目標被剪掉、設定頁的權杖與聊天 ID 輸入框）+ Goal 中間輪不報「回覆完成」（有 Goal 投影時靜默、Goal 停後報最後一條、沒有投影的老宿主照舊報），外加兩條桌面原生通道用例——Windows 原生核准 Toast 正文點選只走宿主 focus 路由才切對話（無 session 時只抬窗不切），macOS 前台點選只靠 1 秒輪詢切對話並在讀走後停止。它還釘住清單：`package.json` 的 `dsh.client.inject` 必須為空、執行時那句 `inject = ["sessions", "locale", "slots"]` 必須原樣保留（[#44](https://github.com/chromoany/dsh-notify-me/issues/44)：載入器把清單讀成「先到達這些整包」，目標到不了，整個條目靜默不跑）。`smoke/host-route-test.mjs` 不需要本機 DSH，`lib/index.js` 的路由、探針與 403/405/501 閘門在任何平臺都會跑。

新增的三個套件同樣自帶假 `ctx`、不聯網、不需要本機 DSH：`smoke/page-bridge-test.mjs` 跑頁面橋接路由的狀態回包形狀、心跳與釋放、缺意圖頭 `403`、跨源 `403`、壞 JSON `400`、超長 `413`，以及 `allowedOrigins` 派生的 `Host`（模擬隧道）放行與路徑衝突；`smoke/host-fallback-test.mjs` 跑宿主兜底——核准去重、`turn/end` 節流、子代理跳過、Goal 還 `active` 時中間輪不投遞（`complete` / `pause` / `block` 之後照常投遞，重啟後能從對話日誌裡補出 Goal 狀態）、租約新鮮時不發、租約過期後發、`alive:false` 後立刻發、語言跟隨心跳、401 後重讀憑證、健康探針；`smoke/relay-route-test.mjs` 跑中繼——`GET` 探針、`405`、跨源 `403`、`413`、`400`、`503`、`200` / `502` 對映與「401 只重試一次」、`relay.bodyTemplate` 的模板渲染與 JSON 轉義、壞模板啟動即不註冊、渲染體積上限；1.24.0 又加了兩組：完成提醒的正文由宿主從對話日誌補齊（保留換行、夾緊後截斷、頁面已給多行正文不覆蓋、`attention` 不動），以及 `snippetLimit: 0` 時只轉對話名、從公網名字進來的請求過了閘門也不讀日誌。

`smoke/mac-notify-test.mjs` 跑 macOS 通知路由：只在 macOS 桌面宿主註冊、探測、`405` / `403` / `501` / `400` 的拒絕、傳給助手的引數（含 `--id` / `--sound` 與 `{remove:id}` 撤回）、點選回傳只被取走一次。它用假的平臺與 Electron 版本號驅動，不需要真的編譯助手，在任何平臺都會跑。

`smoke/mac-notify-content-test.mjs` 跑通知內容：`splitNotificationBody()` 對每一種正文形狀的結果（一行、兩行、空行、首尾空白、CJK、缺欄位）、頁面自己抬好的 `subtitle` 優先生效、只有真有副標題時才傳 `--subtitle`、正文永遠不等於標題（迴歸）、回覆摘要怎麼從事件日誌裡取（跳過工具結果、壓成一行、超長截斷加省略號、空日誌不報錯、只在 `done` 且正文為空時讀）、讀日誌失敗仍照發提醒、以及拆分後再各自截斷（正文 1000 字元、副標題 200 字元）。同樣用假 spawn，不需要真的助手，在任何平臺都會跑。

語言四檔與 Android 退路各自有獨立用例：`smoke/smoke-test.cjs` 的 `languageModes()` 走 `auto` 的兩條識別來源（宿主 locale 與 `document.documentElement.lang`）、`zh-TW` / `zh-HK` / `zh-MO` / `zh-Hant` 都算繁體、`zh-CN` 仍是簡體、無資訊時回落簡體、釘死某一檔後通知與設定頁都跟著變、三份字典鍵集完全一致；`androidWorkerFallback()` 三條：Android UA 下 `new Notification` 一次都不碰、只註冊一個 Service Worker、通知引數（tag / renotify / silent / data）與「只註冊一次」；桌面 UA 下建構子拋 `Illegal constructor` 時先照常呼叫、再回落 Worker 並記住失敗；Worker 也拒收時錯誤進 `debug().lastToastReject` 而不是被吞。`smoke/page-bridge-test.mjs` 另釘住心跳帶 `zh-TW` 被接受、未知語言被忽略、宿主兜底文案與 `pickLanguage` 的優先順序。

`smoke/win-toast-test.mjs` 跑 Windows 原生 Toast 路由：Windows 桌面門控、`GET` 探針、`405` / `403` / `501` / `400` 的拒絕、核准 payload 與 base64 傳遞、首次發 Toast 前的六條註冊命令（`HKCU\Software\Classes\dsh-notify-me` 的三條協議鍵、`AppUserModelId\dsh-notify-me` 的 `DisplayName` 與 `CustomActivator`、以及只建不寫 `LocalServer32` 的空 `CLSID\{…}` 存根）、Windows 10 門控下既不寫登錄檔也不發 Toast、approve / reject / open 動作單次認領、token 過期與 `{remove}` 撤回。它用假的 `spawn` 驅動 `reg.exe` / `powershell.exe`，不需要真的 Windows 桌面宿主。另外斷言處理器指令碼是 UTF-16LE + BOM、正文純 ASCII、含 `ExpandEnvironmentStrings` 表示式、不烘入 profile 路徑，且正文點選只發 `dsh-notify-me://open`（不得再出現 `dsh://open`）；`dsh-notify-me://open` 不帶 session 時仍解析為一次純抬窗（[#40](https://github.com/chromoany/dsh-notify-me/issues/40)）。

改到 `lib/focus-window.ps1` 時（僅 Windows），另需手動跑一次：

```powershell
powershell -NoProfile -File lib/focus-window.ps1 -ProcessId 0   # 末行應是 FOCUSED=1
```

`cordis-host-test.mjs` 會從本機 DSH 安裝借 `@deepseek-ai/cordis`（依次探測 npm 全域性目錄、`~/.dsh/profiles/web/node_modules` 與 `~/.dsh/profiles/node_modules` 平鋪回退目錄）；原始碼 checkout 裡沒有 profile 依賴時，用 `DSH_CORDIS_PATH=<checkout>/vendor/cordis/lib/index.js` 指定即可。

</details>

## 致謝與貢獻須知

| 貢獻者 | 貢獻 |
|:---:|:---|
| <a href="https://github.com/MengHsir"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/MengHsir.png" width="40" height="40" alt="@MengHsir"></a> | [#1](https://github.com/chromoany/dsh-notify-me/issues/1)：「等待核准」不彈提醒的報障，由此定位到 `inject` 殘留讓條目停在 `pending`（1.1.4 修復） |
| <a href="https://github.com/edision"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/edision.png" width="40" height="40" alt="@edision"></a> | [#2](https://github.com/chromoany/dsh-notify-me/issues/2)：「等待核准 / 提問 / 方案確認」不觸發的報障，指出資料來源已遷到 `uiSession`（1.1.6 修復） |
| <a href="https://github.com/azy2"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/azy2.png" width="40" height="40" alt="@azy2"></a> | [#3](https://github.com/chromoany/dsh-notify-me/issues/3)：上一條修復在真機上仍失效的定位——cordis 4 下必須走 `ctx.get()`（1.1.6 修復） |
| <a href="https://github.com/immofon"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/immofon.png" width="40" height="40" alt="@immofon"></a> | [#4](https://github.com/chromoany/dsh-notify-me/issues/4)：macOS 支援的訴求，確認插件只用標準 Web API（1.4.0 起文件按宿主描述） |
| <a href="https://github.com/bakasbk"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/bakasbk.png" width="40" height="40" alt="@bakasbk"></a> | [#5](https://github.com/chromoany/dsh-notify-me/issues/5)：`0.2.0-rc.1` 上安裝被拒的報障，peer 範圍隨後放寬（1.2.0） |
| <a href="https://github.com/XinAnzzZ"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/XinAnzzZ.png" width="40" height="40" alt="@XinAnzzZ"></a> | [#6](https://github.com/chromoany/dsh-notify-me/issues/6)：「需要你操作」全程啞火的報障，指出要遷到 `uiSession.sessionStatus`（1.2.0 修復） |
| <a href="https://github.com/AgMahone"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/AgMahone.png" width="40" height="40" alt="@AgMahone"></a> | [#7](https://github.com/chromoany/dsh-notify-me/pull/7)：宿主代際相容（0.1.6+ / 0.2.0）的報障與複測 |
| <a href="https://github.com/d0ublecl1ck"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/d0ublecl1ck.png" width="40" height="40" alt="@d0ublecl1ck"></a> | [#8](https://github.com/chromoany/dsh-notify-me/pull/8)：子代理對話靜音（`ignoreSubagent`） |
| <a href="https://github.com/EliteOtaku"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/EliteOtaku.png" width="40" height="40" alt="@EliteOtaku"></a> | [#9](https://github.com/chromoany/dsh-notify-me/issues/9)：桌面端抬窗鏈路的逐層排查與真實殼複測 |
| <a href="https://github.com/Wh1stle05"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/Wh1stle05.png" width="40" height="40" alt="@Wh1stle05"></a> | [#10](https://github.com/chromoany/dsh-notify-me/pull/10)：「音效來源」（合成音 / 自定義音訊 / 系統通知音） |
| <a href="https://github.com/yanzhaohui1999"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/yanzhaohui1999.png" width="40" height="40" alt="@yanzhaohui1999"></a> | [#13](https://github.com/chromoany/dsh-notify-me/issues/13) / [#14](https://github.com/chromoany/dsh-notify-me/pull/14)：多對話下空閒頁面佔 CPU 的效能報告與修復 |
| <a href="https://github.com/RiZhiZhaoYi"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/RiZhiZhaoYi.png" width="40" height="40" alt="@RiZhiZhaoYi"></a> | [#12](https://github.com/chromoany/dsh-notify-me/issues/12)：外部通知轉發（Discord / Bark / Gotify / Webhook） |
| <a href="https://github.com/yuexian7"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/yuexian7.png" width="40" height="40" alt="@yuexian7"></a> | [#17](https://github.com/chromoany/dsh-notify-me/issues/17)：手機端收訊息的訴求，促成飛書 / Server酱 / WxPusher 三種目標 |
| <a href="https://github.com/shrekcg"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/shrekcg.png" width="40" height="40" alt="@shrekcg"></a> | [#16](https://github.com/chromoany/dsh-notify-me/pull/16)：離開判定 `idleMinutes`、「回覆完成」`donePolicy`、自動消失 `autoDismiss` |
| <a href="https://github.com/Donald-Yip"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/Donald-Yip.png" width="40" height="40" alt="@Donald-Yip"></a> | #18（原 issue 已刪除）：Windows 通知 tag 超 64 字元、核准測試通知被平臺拒收的報告 |
| <a href="https://github.com/dunxuan"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/dunxuan.png" width="40" height="40" alt="@dunxuan"></a> | [#20](https://github.com/chromoany/dsh-notify-me/issues/20)：目前對話的通知正文用佔位符、未取對話標題的報告 |
| <a href="https://github.com/unnamed42"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/unnamed42.png" width="40" height="40" alt="@unnamed42"></a> | [#21](https://github.com/chromoany/dsh-notify-me/issues/21) / [#22](https://github.com/chromoany/dsh-notify-me/pull/22)：Linux 上深鏈抬窗失效的報障與補丁（1.14.4 恢復） |
| <a href="https://github.com/LIEGU0317"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/LIEGU0317.png" width="40" height="40" alt="@LIEGU0317"></a> | [#24](https://github.com/chromoany/dsh-notify-me/issues/24) / [#25](https://github.com/chromoany/dsh-notify-me/pull/25) / [#29](https://github.com/chromoany/dsh-notify-me/issues/29) / [#30](https://github.com/chromoany/dsh-notify-me/pull/30)：宿主兜底推送與同源中繼兩個模組，及其轉發開關的修復（1.19.0） |
| <a href="https://github.com/ekexium"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/ekexium.png" width="40" height="40" alt="@ekexium"></a> | [#23](https://github.com/chromoany/dsh-notify-me/issues/23)：按對話靜音的訴求（1.16.0 支援） |
| <a href="https://github.com/AomiRaku"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/AomiRaku.png" width="40" height="40" alt="@AomiRaku"></a> | [#26](https://github.com/chromoany/dsh-notify-me/issues/26)：靜音鈴鐺遮擋標題的反饋，改為可隱藏並補右鍵入口（1.18.0 支援） |
| <a href="https://github.com/Matthew-Laplace"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/Matthew-Laplace.png" width="40" height="40" alt="@Matthew-Laplace"></a> | [#27](https://github.com/chromoany/dsh-notify-me/issues/27) / [#28](https://github.com/chromoany/dsh-notify-me/pull/28)：`keepOnReturn` 的提案與最小實現、「前台也提醒」一鍵預設（1.19.0 支援） |
| <a href="https://github.com/xty13114150041"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/xty13114150041.png" width="40" height="40" alt="@xty13114150041"></a> | [#31](https://github.com/chromoany/dsh-notify-me/issues/31) / [#32](https://github.com/chromoany/dsh-notify-me/pull/32)：macOS 頁面通知不響的排查與宿主助手方案（1.19.0 支援） |
| <a href="https://github.com/Inh-ui"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/Inh-ui.png" width="40" height="40" alt="@Inh-ui"></a> | [#33](https://github.com/chromoany/dsh-notify-me/issues/33)：核准通知缺按鈕的反饋，以及 Electron 丟棄 `actions` 的原始碼級定位（1.19.0 支援） |
| <a href="https://github.com/sakurakugu"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/sakurakugu.png" width="40" height="40" alt="@sakurakugu"></a> | [#34](https://github.com/chromoany/dsh-notify-me/pull/34)：同源中繼的自定義 JSON 請求體模板（1.20.0 支援）；[#52](https://github.com/chromoany/dsh-notify-me/pull/52)：完成提醒缺正文時由宿主從對話日誌補齊（1.24.0 支援） |
| <a href="https://github.com/AlbertDope"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/AlbertDope.png" width="40" height="40" alt="@AlbertDope"></a> | [#36](https://github.com/chromoany/dsh-notify-me/issues/36)：中文使用者名下核准按鈕必彈 `800A004C` 的根因定位與修復驗證（1.20.1） |
| <a href="https://github.com/yangmin19990201-crypto"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/yangmin19990201-crypto.png" width="40" height="40" alt="@yangmin19990201-crypto"></a> | [#37](https://github.com/chromoany/dsh-notify-me/issues/37)：同一 `800A004C` 的獨立復現與根因核對（1.20.1） |
| <a href="https://github.com/TianqiCai"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/TianqiCai.png" width="40" height="40" alt="@TianqiCai"></a> | [#38](https://github.com/chromoany/dsh-notify-me/pull/38)：macOS 前台點通知不切對話的修復（1.21.0 收編） |
| <a href="https://github.com/MVennn"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/MVennn.png" width="40" height="40" alt="@MVennn"></a> | [#40](https://github.com/chromoany/dsh-notify-me/issues/40)：原生核准 Toast 點正文不喚醒最小化/系統匣視窗的報障與定位（1.21.0 修復） |
| <a href="https://github.com/fgql"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/fgql.png" width="40" height="40" alt="@fgql"></a> | [#41](https://github.com/chromoany/dsh-notify-me/issues/41) / [#42](https://github.com/chromoany/dsh-notify-me/issues/42)：核准 Toast 按鈕不派發協議啟用、桌面端視窗越抬越沉（1.21.2–1.21.4 修復） |
| <a href="https://github.com/you9you"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/you9you.png" width="40" height="40" alt="@you9you"></a> | [#43](https://github.com/chromoany/dsh-notify-me/pull/43)：關掉「提醒音」後頁面仍佔音訊輸出裝置的報障、管道級復現與首版補丁（1.21.5 收編） |
| <a href="https://github.com/Mz135mz"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/Mz135mz.png" width="40" height="40" alt="@Mz135mz"></a> | [#44](https://github.com/chromoany/dsh-notify-me/issues/44)：客戶端半身從未 apply 的報障與雙向復現（1.21.6 修復） |
| <a href="https://github.com/01101sam"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/01101sam.png" width="40" height="40" alt="@01101sam"></a> | [#45](https://github.com/chromoany/dsh-notify-me/pull/45) / [#46](https://github.com/chromoany/dsh-notify-me/pull/46)：連續 Goal 中間輪次誤報「回覆完成」的診斷與首版補丁、Telegram 外部推送（1.22.0 收編） |
| <a href="https://github.com/CheungPuiKwan"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/CheungPuiKwan.png" width="40" height="40" alt="@CheungPuiKwan"></a> | [#49](https://github.com/chromoany/dsh-notify-me/issues/49) / [#50](https://github.com/chromoany/dsh-notify-me/pull/50)：macOS 通知只剩對話名、正文取不到回覆內容的定位，與把對話名抬進 subtitle、宿主補回覆摘要的補丁（1.23.0 收編） |
| <a href="https://github.com/wx233Github"><img src="https://raw.githubusercontent.com/chromoany/dsh-notify-me/main/docs/contributors/wx233Github.png" width="40" height="40" alt="@wx233Github"></a> | [#51](https://github.com/chromoany/dsh-notify-me/issues/51)：Android Chrome 裡 `new Notification()` 拋 Illegal constructor 的報障、重現與改走 Service Worker 的補丁（1.23.0 修復） |

署名口徑：本倉庫收編外部 PR 時以維護者提交落地——不沿用原 commit、不掛 Co-authored-by，GitHub 的 contributors 圖只顯示維護者，貢獻者以上面的致謝署名。

## Star History

<details>
<summary>展開 Star History 圖表</summary>

<a href="https://www.star-history.com/?repos=chromoany%2Fdsh-notify-me&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=chromoany/dsh-notify-me&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=chromoany/dsh-notify-me&type=date&legend=bottom-right" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=chromoany/dsh-notify-me&type=date&legend=bottom-right" />
 </picture>
</a>

</details>

## License

MIT — 見 [LICENSE](LICENSE)。
