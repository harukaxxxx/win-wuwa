# Issue #20：本機整合交付（完整真環境驗收未完成）

本頁只記本次 `d25737d7bfa94ba14fa7aa2782eabe71a14cc60b` 上的工作樹；先前各票的瀏覽器證據不視為本次完整流程。無部署、遠端 Cloudflare/D1、真 Discord 或真實裝置操作。本機 browser fixture 使用 production Worker bundle 與 `public` 靜態來源、真 workerd、本機隔離 D1 和合成 OAuth；其 ASSETS 是 test-only binding，不驗證正式 Wrangler 靜態資產路由。fixture 插入的分數、基準及額外 winner 均為合成 SQL 資料。

## 本次交付重驗

在 profile scratch `issue20-final-verify/source` 的隔離來源與依賴上完成本次交付重驗：`npm run typecheck`、`npm test`、`npm run build` 全部 exit 0，191 passed、0 failed、0 skipped，build 僅為 Wrangler dry-run。日誌位於 `issue20-final-verify/{typecheck-rerun,test-rerun,build-rerun}.log`。一次中間執行因固定測試埠 19818／19819 占用而失敗，未停止他人程序；待埠釋放後完整重跑通過，不將失敗紀錄刪除或當成通過。

最終 nonsettlement receipt 的八個來源雜湊已與目前檔案核對一致；沿用該版本完整瀏覽器流程證據，不宣稱此次重跑所有歷史 browser 情境。提交前獨立內容審查未見阻擋此有限本機交付的缺陷；原始驗收矩陣與未跑項目保留如下。實作交付不再以真 provider／實機全部驗收作為推進下一票的前置條件。

## 驗收矩陣

| AC／情境 | 本次結果與證據 |
|---|---|
| 主播取消／恢復，202 本文截斷、讀取失敗後重整，同 key 繼續 | **本機 fixture PASS**：390 CSS px，innerWidth/clientWidth/scrollWidth 均 390；先 202 再 200，同一路徑；取消後合成 winner 300 恢復 7、另一人 4、額外 1001 人各 5；公開 winners 空。新場名單空、重新報名序號 1，停用主播無抽選取消不改分。過程是同瀏覽器登出後切換合成身分，不是雙 session 隔離驗證。[收據](evidence/issue-20-browser/cancellation-receipt.json)、[畫面](evidence/issue-20-browser/cancelling-390.png)。截圖只顯示上半部；續跑按鈕在下方，腳本以焦點＋Enter 操作。開啟 touch emulation 但以 click 操作，**不宣稱實際觸控操作驗收**。 |
| 桌面鍵盤登入／報名 | **本機 fixture PASS**：1365 CSS px；Tab 到登入連結，`:focus-visible` 為 true 且 outline 為 solid，Enter 登入、聚焦按鈕後 Enter 報名序號 1；scrollWidth 1365。[收據](evidence/issue-20-browser/desktop-receipt.json)、[畫面](evidence/issue-20-browser/desktop-keyboard.png)。不等於所有控制均可用 Tab 到達。 |
| 取消文案 | **本機 PASS**：移除錯誤的「取消恢復尚未實作」，改為取消效果及可續跑說明；`test/ui-current-copy.test.mjs` 修正前 assertion RED、修正後 GREEN。 |
| 受限群 pending／nonmember 邀請／429／provider error／重新授權 | **本機 fixture PASS（指定情境）**：[收據](evidence/issue-20-browser/independent-receipt.json)。pending 等狀態均停用報名；nonmember 才顯示合成邀請連結且新分頁安全屬性存在；429 顯示 30 秒；error 清楚表示未知；每次明確重新授權僅一次合成 member 查詢；member 才允許報名。合成受限群註冊、抽選及重整後公開 `群暱稱 300`。另有不限定群遮罩結果的 API 證據，見下。 |
| 主播／觀眾同時 session、暫停／恢復、退出後不能重報、暫停抽選後重整不重抽 | **本機 fixture PASS（host cookie 隔離）**：同一瀏覽器 context 的 `localhost` 與 `127.0.0.1` 同時分別登入 123／300，CSRF 不同，同一 D1 同場；主播暫停後觀眾舊頁報名遭拒且零筆、重整後按鈕停用，恢復後 CDP `touchStart`／`touchEnd` 報名、退出並刷新保留，直接重報 409；觀眾 host 登出後另一新 session 301 報名序號 2，主播保持登入，暫停時抽中 2，主播及觀眾重整後結果不變，draw PUT 仍 1 次。這是 host-only cookie 隔離，**不是獨立 browser context 或兩台設備**。報名去重與機率更新另見下列 19985 獨立情境。 |
| 主播私有名單、聯絡與剪貼簿拒絕退回 | **本機 fixture PASS（指定情境）**：受限群合成一人名單、Discord 聯絡 URL、人工注入剪貼簿拒絕後選取 username 與提示手動複製；另在 19985 以合成資料驗證 53 筆名單分頁，見下。 |
| 結算 202 本文截斷、同 key 手動續跑、停用仍可收尾 | **本次未跑**；準備執行的命令遭工具要求核准，未執行；未改道繞過。 |
| 新受限群場重新驗證；原創素材授權逐項審核；完整 loading/error/empty 與全控制焦點 | **本次未跑**。 |
| 真 iPhone／Safari／觸控、真 Discord OAuth 和權限、遠端 D1／Cloudflare | **人工／平台證據待補，未測**。 |

19984 情境中程式化 focus 的 `:focus-visible=false`、outline `none`，不是鍵盤 Tab 測試；後續 19985 另以真正 Tab 和 390 CSS 寬度驗到登入連結可視焦點，見下。這不表示所有控制都驗過。

## 測試

最後一次在 `issue20-v4a/source` 隔離副本：`npm run typecheck` 通過；`npm test`（含 Wrangler dry-run build）**191 passed、0 failed**。`npm audit` 及 `npm audit --omit=dev` 均為 0 vulnerabilities；完整日誌在 profile scratch `issue20-v4a/{typecheck,tests,audit,audit-production}.log`。測試、dry-run 的 cwd、TMPDIR、npm cache、XDG cache 和 Wrangler 目錄均在隔離副本或 scratch，未覆寫原 repo dist。這些結果不補足上表未跑之瀏覽器項目。

## 重現範圍與隔離

把來源複製到 profile scratch 的 `issue20-qa/source`，排除 `.git`、`node_modules`、`dist`、`.wrangler`、`.dev.vars`；另複製獨立 `node_modules`。在該副本將 `TMPDIR` 與 `npm_config_cache` 指向 `issue20-qa/tmp` 和 `issue20-qa/cache`，執行 build/test。絕不覆寫原 repo `dist`，不碰原 19481 preview。下列為一次性合成 fixture；每個 scenario 都須重啟以清空 D1，且勿並行共用 localhost cookies：

```sh
# 從上述隔離 source，先 npm run build，並確定 19981／19983 未占用
WUWA_FIXTURE_PORT=19981 WUWA_VIEWER_QA=1 WUWA_MANAGEMENT_QA=1 WUWA_STATUS_QA=1 WUWA_DRAW_QA=1 WUWA_SETTLEMENT_QA=1 WUWA_CANCELLATION_QA=1 node test/browser-fixture.mjs
# 另一個 shell，等待 FIXTURE READY，再執行：
ego-browser nodejs < test/browser-issue20-cancellation.mjs
# 停止 19981；重新啟動隔離 fixture：
WUWA_FIXTURE_PORT=19983 WUWA_VIEWER_QA=1 WUWA_MANAGEMENT_QA=1 WUWA_STATUS_QA=1 WUWA_DRAW_QA=1 WUWA_SETTLEMENT_QA=1 node test/browser-fixture.mjs
# 另一個 shell：
ego-browser nodejs < test/browser-issue20-keyboard.mjs
```

腳本輸出路徑目前綁定本機 profile scratch（需在其他機器修改），僅可對合成資料使用。伺服器只綁 loopback，所有外連由 fixture 攔截或拒絕；本次 19981、19982、19983 均已停止。要完成本票須實際補齊上述未跑清單；此頁不授權關閉 issue、提交或部署。

### 19984 host 隔離情境重現

下列操作僅在新的 scratch 副本執行，patch 只改 fixture，不改 production Worker 或 public；source/public 的五個檔案與本次 repo public SHA-256 一致。fixture 只接受兩個指定 Host，對 `/api/` 非 GET 要求精確同 Host Origin，驗過跨 Host POST 為 403，再在 fixture 內將合法 Origin 轉換成 Worker 設定的 localhost Origin；這不驗證正式部署的雙 hostname OAuth／CSRF。受限群前的 `terminate`／`new`／`seed-restricted` 是合成 D1 直接設定，不是產品取消或開場流程；未呼叫結算。要重跑須使用新的空 D1、等待 fixture ready，且避免同時使用其他 localhost fixture（cookie 同 host 共用）。

```sh
REPO=/Users/haruka/.hermes/profiles/makino-futsuki/workspace/win-wuwa
QA=/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch/issue20-independent
mkdir -p "$QA" "$QA/tmp" "$QA/cache"
SRC=$(mktemp -d "$QA/source.XXXXXX")
rsync -a --exclude=.git --exclude=node_modules --exclude=dist --exclude=.wrangler --exclude=.dev.vars "$REPO/" "$SRC/"
cp -cR "$REPO/node_modules" "$SRC/"
cd "$SRC"
patch -p0 < "$REPO/docs/evidence/issue-20-browser/independent-fixture.patch"
export TMPDIR="$QA/tmp" npm_config_cache="$QA/cache"
npm run build
WUWA_FIXTURE_PORT=19984 WUWA_VIEWER_QA=1 WUWA_MANAGEMENT_QA=1 WUWA_STATUS_QA=1 WUWA_DRAW_QA=1 WUWA_GUILD_QA=1 WUWA_NAME_QA=masked node test/browser-fixture.mjs
# 另一 shell，看到 FIXTURE READY 後執行：
ego-browser nodejs < "$REPO/test/browser-issue20-sessions.mjs"
# 結束後停止自己啟動的 fixture；receipt 輸出於 $QA/receipt.json。
```

本次完整腳本重新執行成功，19984 隨後已停止；public 沒有再改。隔離 build dry-run 成功；190 tests／offline audit 是前批相同 production bytes 的結果，**不是本批重新執行**。本批沒有部署、真帳戶、遠端 D1、審批繞道、提交或推送。

### 19985 非結算補充（歷史分段執行，本機合成）

同一個新隔離副本及 loopback fixture，以 sequential 身分切換執行；沒有獨立 browser context、真設備或真 Discord。測試 fixture 的[補丁](evidence/issue-20-browser/final-fixture.patch)只增加拒絕授權連結與 51 個合成名單，未改 production assets；[收據](evidence/issue-20-browser/final-nonsettlement-receipt.json)記錄第二階段，fixture 已停止。

- 報名：同一 `activity_id`／viewer／rule 的同一 POST 重送回傳序號 1；完整 registrations 及人數不變。這是資料模型的自然去重鍵，**不是獨立 request-key 欄位**。
- 機率：第二名觀眾退出前後，當前單抽由 50.04% 變為 100.00%，候選版本 2→3，兩次更新時間均存在且畫面分別顯示；均為同一活動。機率不是整場中獎保證。
- OAuth：真實 production callback 原本對合成 `access_denied` 回 400。修正後瀏覽器取消回到 `/s/123` 且零報名；回歸測試覆蓋無 cookie、錯 issuer、重複 state、同時有 code、重播及未增加 session／intent。不是實際 Discord provider 驗收。
- 不限定群且 global_name 為 null：抽選後公開 results API 僅有 `f***0`，不含原 username；member API 呼叫 0。**本批未在觀眾頁重新檢查渲染文字**，不能把 API 證據說成 UI 驗收。
- 主播名單：兩位自然報名者加 51 筆合成 SQL 參與者，首次顯示 50；同步快速觸發兩次「更多名單」，最終序號 1–53 各一次。這是 DOM `.click()` 快速觸發，不冒充實際觸控。
- 390 CSS px：Tab 聚焦登入連結，驗 `:focus-visible` 和 computed outline／box-shadow，innerWidth、clientWidth、scrollWidth 均 390；[截圖](evidence/issue-20-browser/final-keyboard-390.png)可見白色外框。僅該控制，不等於全控制或實機鍵盤驗收。

首次腳本已通過焦點、拒絕授權及報名去重；把預期的雙人機率錯寫為 50.00%，實際權重依序號為 50.04%，故等待逾時。保留同一執行中的 fixture 與 task space，後續獨立階段驗證重送、50.04%→100%、遮罩 API、分頁並寫入收據；原始腳本已修正公式，但**尚未整支從頭重跑**。合成 SQL 名單不是經報名 UI 新增；本次不碰結算。

上述為歷史分段結果；最終版的完整重跑見下。

### V4A 最終版非結算完整重跑（19986）

新建 `cache/scratch/issue20-v4a/source` 來源及獨立 dependencies，套用同一 fixture 補丁；在全新 loopback 19986 合成 D1 上一次從頭執行完整 `test/browser-issue20-nonsettlement.mjs`，正常結束並停止 fixture。[最終收據](evidence/issue-20-browser/v4a-final-receipt.json)記錄最終腳本與相關來源 SHA-256、**3 個 PASS 檢查點**（焦點／OAuth 取消、報名去重／機率、遮罩／名單）；[鍵盤截圖](evidence/issue-20-browser/v4a-keyboard-390.png)，完整輸出在 scratch `issue20-v4a/browser.log`。腳本 SHA-256 為 `1c1d41638d4888d546f26bfd577888e98ac6c995a30d9a3d31d9bce7101d298a`，與隔離副本一致。

觀眾頁 `/s/123` 的中獎結果 DOM 確實顯示 `f***0`、元素有可見幾何框且頁面 DOM 文字不包含 `fixture_300`；公開 API 同樣不含該 username，合成 member 查詢為零。名單 50 → 53 且 53 個序號唯一；390 CSS px 的登入連結具鍵盤可見焦點。機率在此完整腳本中先 100% 再 50.04%，不是上方歷史分段的測試順序。身分仍是單一瀏覽器 context 依序切換，合成 fixture 不代表實機或真 provider。

重跑須以隔離 source build，啟動 `WUWA_FIXTURE_PORT=19986 WUWA_VIEWER_QA=1 WUWA_MANAGEMENT_QA=1 WUWA_STATUS_QA=1 WUWA_DRAW_QA=1 WUWA_GUILD_QA=1 WUWA_NAME_QA=masked node test/browser-fixture.mjs`，在 ready 後執行 `ego-browser nodejs < test/browser-issue20-nonsettlement.mjs`，使用空 fixture、專屬 scratch 路徑且結束自己的程序；腳本的 port 和收據絕對路徑綁定本機。此重跑不觸發結算；結算續跑原核准、獨立 context、實機、真 provider／遠端 D1 及其他上表項目仍未完成，#20 不可宣稱完成。
