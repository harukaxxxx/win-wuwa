# Issue #23 上線準備證據（本機工程交付，未部署）

## 最終整合重驗

父代理在 profile scratch `wuwa-integrated23/source` 整合 #22 `6cfce2c` 與本次文案、Node-only reader 後執行 `npm run typecheck`、`npm test`，均 exit 0；完整測試 **194 passed、0 failed、0 skipped**，包含 Wrangler dry-run build。日誌為 scratch `wuwa-integrated23/{typecheck,tests}.log`。以下舊版 reader 的 192 結果僅保留歷史，不代表最終版本。

同一來源啟動獨立 loopback `http://localhost:19787` 合成 fixture，Ego TaskSpace 53 完成：觀眾 300 登入 → 報名序號 1 → 重新整理保留 → 展開現行隱私告知；當時 CSS innerWidth/clientWidth/scrollWidth 均 390。DOM 讀到完整現行四段告知及人工 mailto；截圖僅顯示捲動位置的上段，非全文截圖。之後登出、切換合成主播 123 登入 → 抽中序號 1 → 重新整理仍為同一結果，fixture 記錄 draw PUT 只有 1 次；觀眾頁公開顯示「測試顯示 300」。這是單一 browser context 依序切換合成身分，不是同時雙 session／實機／真 Discord。沒有執行結算 browser 或先前被擋的操作，也未以此取代原 #20 未跑清單。

本機 fixture 使用獨立暫存 D1、production Worker bundle 與測試 ASSETS binding，所有外連均合成或拒絕；只綁 loopback，沒有區網或公開入口，不使用真資料。預覽程序是本 session 的背景服務，非永久運維或已部署服務。

## 目前工程交付

#20 `f825490`、#21 `77a7e84`、#22 `6cfce2c` 已整合並推送 `dev`。本文件隨 #23 整合現行隱私告知及 Node-only reader 測試。已知有限 MVP 功能已有本機實作；以下真 provider／實機／法律／部署與特定未跑測試，仍非通過，不因本機工程交付而假勾。#17 角色動畫依負責人決定延期。

#22 相同 5×500×20 本機情境：writes 116,935 → 67,885、reads 4,368,961 → 496,813；全部 49,050 快照及 8,005 分數保留，完整測試 193/193。方法、原始資料、遷移及免費限額界線見 [容量證據與修補](issue-22-optimization.md)。本機數字不是遠端帳戶用量；全表遷移、舊 writer 切換、50-query 計數與 CPU 仍須授權環境驗證。

## 盤點來源與讀法

本稿沿用 2026-11-10 的唯讀盤點，並在獨立 scratch 副本依 dev HEAD `77a7e8432611831d6f6a053d090a75e6946b6fce` 更新；#20 已於 `f825490`、#21 已於 `77a7e84` 整合。規格為 `docs/development-plan.md`、`CONTEXT.md`；原盤點時 GitHub #1、#20、#21、#23 均 OPEN、comments 空，當時 #1 Current delivery status 停在 #8，為過時狀態，非本次 tracker 即時查驗。#21 文件記載其隔離快照 typecheck 與 191/191，並非真 provider、遠端 D1 或手機；歷史收據仍受各自來源快照限制。本稿隱私變更與本次測試結果見文末；未讀秘密、未部署、未更新 tracker。

下表「證據」均相對專案根目錄；局部證據非 AC 全數通過，且較早切片內「未實作」可能已由後續切片實作。每列除具體缺口外，均受上述合成／遠端限制約束。

| AC | 實作入口 | 現有可核驗證據 | 缺口類別與限制 |
|---|---|---|---|
| 01 隔離 | `src/index.ts`、`migrations/0004_activities.sql`、`src/settlement.ts` | `docs/issue-9-evidence.md`、`docs/issue-15-evidence.md`；`test/session-opening.test.mjs`、`test/settlement.test.mjs` | 指定合成情境；未驗遠端 D1/真帳號，不代表所有競態。 |
| 02 管理資格 | `src/index.ts` 管理 API、`public/index.html`/`app.js` | `docs/issue-9-evidence.md`、`test/management.test.mjs` | usage 僅站內登入啟動數，不是 Cloudflare 共用額度；真配置、帳戶用量待驗。 |
| 03 停用及重核准 | `src/index.ts`、`migrations/0003_streamer_status.sql` | #9、#10、#14、#15、#18 證據；`test/management.test.mjs`、`test/draw-interleave.test.mjs` | 開場、抽選有指定邊界證據；報名／停用有 HTTP 重疊，未證兩種 SQL 提交交錯；真 provider/遠端待驗。 |
| 04 未完成場占位 | `src/index.ts`、`migrations/0004_activities.sql`、`src/settlement.ts`、`src/cancellation.ts` | #10、#15、#18 證據；`test/session-opening.test.mjs` | 本地指定場景與約束；遠端 D1 未驗。 |
| 05 暫停／恢復 | `src/index.ts`、`public/app.js`、`public/viewer.js` | `docs/issue-13-evidence.md`、#20 收據；`test/pause-withdraw.test.mjs` | 暫停與報名 HTTP 重疊非窮舉精確提交邊界；真手機未測。 |
| 06 離線 | `src/index.ts`、`public/app.js` | #10 `test/session-opening.test.mjs` 登出新 session；#20 合成 UI | 關頁、逾時、斷線及全流程不等同皆完成實機驗證。 |
| 07 鎖規則／換場 | `src/index.ts`、`migrations/0005_opening_generation.sql`、`0008_viewer_oauth.sql` | #10、#11、#18；`test/viewer-oauth.test.mjs`、`test/cancellation.test.mjs` | OAuth 遲到及新場為合成；#20 新受限群場重新驗證未跑，真 provider 未測。 |
| 08 Discord 資格 | `src/index.ts` OAuth 與 member endpoint，`public/viewer.js` | `docs/issue-12-evidence.md`；`test/guild-membership.test.mjs`；#20 `docs/evidence/issue-20-browser/independent-receipt.json` | 必須真 provider 驗 member/pending/nonmember、scope 變更、可得錯誤；member 物件若缺可選 user.id 目前 fail closed，可能誤拒。 |
| 09 退出 | `src/index.ts`、`public/viewer.js`、`src/draw.ts` | #13、#14；`test/pause-withdraw.test.mjs`、`test/draw-interleave.test.mjs` | 已有抽選相關指定邊界及 HTTP 情境，不等於所有排程或裝置。 |
| 10 抽選 | `src/draw.ts`、`src/draw-formula.ts`、`migrations/0012_draws.sql` | #14；`test/draw-interleave.test.mjs`、`test/draw-kill.test.mjs` | SIGKILL 發生已提交後 HTTP 回應前；非 SQL 執行中斷電、遠端驗證；大候選負載另 #22。 |
| 11 分數正常結算 | `src/settlement.ts`、`migrations/0013_settlement.sql` | #15；`test/settlement.test.mjs`、`test/settlement-interleave.test.mjs`，含跨場 10→9 | 實際 D1 負載、遠端與斷電提交中未知結果待驗。 |
| 12 無抽與終點順序 | `src/draw.ts`、`src/settlement.ts` | #14、#15；`test/settlement-interleave.test.mjs` | 指定提交邊界而非全部網路排程；遠端未驗。 |
| 13 取消恢復 | `src/cancellation.ts`、`migrations/0017_cancellation.sql`、`public/app.js` | #18；`test/cancellation-interleave.test.mjs`、`docs/evidence/issue-20-browser/cancellation-receipt.json` | graceful restart 非提交中強制斷電；遠端、實機未驗。 |
| 14 公式與模擬 | `src/draw-formula.ts`、`test/draw-simulation.mjs` | `docs/issue-14-evidence.md`、`docs/issue-14-simulation.json`、`test/draw-formula.test.mjs` | 10,000 合成獨立場各 3 抽、初始固定分數；不模擬跨場結算，非真隨機或容量驗證。 |
| 15 公開結果與機率 | `src/results.ts`、`public/viewer.js`、`migrations/0015_candidate_revision.sql`、`0016_registration_names.sql` | #16 原始 API 及 name snapshot 測試；#20 `v4a-final-receipt.json` 遮罩 DOM/API | 公開結果只提供當前未完成場，規格未明定結束後公開歷史；真 Discord 名稱欄位未驗。 |
| 16 身分與聯絡 | `src/index.ts`、`src/results.ts`、`public/app.js` | #16 `test/results-contact.test.mjs`、`docs/evidence/issue-16-browser/denied-receipt.json` | 剪貼簿拒絕為合成注入；未驗真 Discord 開啟、私訊或送達，網站本不代發。 |
| 17 保留與隱私 | `src/retention.ts`、`migrations/0018_history_retention.sql`、`public/viewer.html` | #19 `test/history-retention.test.mjs`、`test/history-retention-restart.test.mjs`；#5 文案於 viewer | 手動管理 API 有實作，無排程；實際持續執行運維尚無；精確 90 天不刪、超過才可處理，無固定完成期限。舊 writer 須先停止及排空；法律與最終告知未審查。 |
| 18 D1／OAuth 安全 | `src/index.ts`、`src/draw.ts`、`src/settlement.ts`、`src/cancellation.ts`、`src/retention.ts` | #8、#14、#15、#18、#19，見下方 #21 矩陣 | 本機局部指定交錯及 synthetic secret log 掃描；真 provider、遠端 D1、提交中故障、production logs 尚未驗。 |
| 19 容量 | `src/draw.ts`、`src/settlement.ts`、`migrations/0019_candidate_storage.sql` | #22 基準及修補後相同五主播各 500 × 20 抽：496,813 reads、67,885 writes；193 tests 通過，完整快照與分數保留 | 排除登入、開場、遷移及共享其他用量；非遠端計費、CPU、50-query 計數或任意歷史量遷移驗收。 |
| 20 UI／素材 | `public/index.html`、`public/viewer.html`、`public/style.css`、`public/app.js`、`public/viewer.js` | #20 `docs/issue-20-evidence.md`、`docs/evidence/issue-20-browser/v4a-final-receipt.json`、#16/#18 receipts | 390 CSS 模擬、部分鍵盤/觸控，不是實機；#20 結算續跑本次原核准未執行。字型見下；#17 角色動畫延期，非 blocker。 |

## #21 測試現況與精確空白

- `test/prototype.test.mjs` 測 state、S256、cookie、CSRF、約束、batch rollback、合成 secret 的 response/runtime log；`test/viewer-oauth.test.mjs` 測 context/state 跨 session 與 access_denied 重放。#8 的文檔列 Discord 官方 OAuth/PKCE metadata 與 D1 batch 文件；非真 provider 或完整生產日誌稽核。
- `test/session-opening.test.mjs` 驗停用先於開場 batch；`test/draw-interleave.test.mjs` 驗候選變更、退出、停用與 winner 更新回滾；`test/settlement-interleave.test.mjs` 驗報名／退出／抽選與結算指定次序、session 失效；`test/cancellation-interleave.test.mjs` 驗取消與結算、抽選、報名、退出指定次序；`test/history-retention.test.mjs` 驗清理與 rollback。以上是不同切片的有界交錯，不應聲稱單一全流程或所有排程都證明。
- 優先釐清／補測：停用與報名、暫停與報名在提交邊界兩方向目前看到的是重疊 HTTP 而非指定 SQL 邊界；清理並發目前 overlapping HTTP 而非窮舉；若需聲稱強制中斷安全，補上實際指定階段測試或如實保留限制。#15/#18/#19 的 graceful restart 不能改稱提交過程 SIGKILL／斷電；#14 SIGKILL 只是已提交後。遠端 D1 安全驗證需另行授權資源；測試不通過須停止並重新設計，而不是假設合法。
- #21 已整合於 `77a7e84`，其 `docs/issue-21-evidence.md` 記錄本機 191/191；指定交錯、合成 provider 和故障邊界依該文件，不等於遠端驗收。

## 素材、隱私、OAuth 與運維具體查核

- `public/style.css` 實際 `font-family:ui-serif,Georgia,serif`：瀏覽器／系統選擇本機字型，Georgia 是 CSS 家族名稱，不是 repo 提供的字型檔；中文 fallback 依使用者系統而異。`public` 盤點只有 HTML/CSS/JS，CSS 無 `@font-face`、外部 `@import` 或 font URL，未見字型檔／遠端字型服務。這不是已核對各平台系統字型授權；記錄實際發行方式和使用條件，不能假造字型 license 或聲稱法律結論。現行幾何由 CSS 繪製，盤點未見鳴潮官方角色、Logo、圖片或音效檔；不證明完整商標法律審查。
- 本次 scratch 的 `public/viewer.html` 已將抽選、中獎者改成現況，交代超過 90 天才可人工逐批清理、無固定排程及完成期限、未知完成時間不清理，以及共用身分/session、分數與 tombstone 保留；人工請求為 `mailto:contact@makinoworks.com`。信箱實際營運及適用法律/最終文案尚需確認，不能把 #5 政策等同審查。
- `src/index.ts` 以配置 `ORIGIN`、`DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET` 構成精確 `<origin>/auth/callback`，state 與 S256，依群限制最小 scope；`ADMIN_DISCORD_ID` 控管管理者。只檢程式與 `wrangler.jsonc`，未讀秘密或查真 app 配置；該檔 DB 是全零本機 placeholder，不是已配置遠端 D1。真 redirect 註冊、client、HTTPS origin、管理者設定、部署綁定與正式 secret 儲存均未知。真 Discord 不可用 fixture 結果替代。
- 清理必須管理員重複呼叫 `/api/admin/history-retention` 直到 `has_more:false`，非自動執行；舊 writer 和 callback 在開始清理前必須停用並排空，未知完成時間歷史保留。這是已實作運維契約，但目前無排程與部署證據。備份/Time Travel 物理刪除未驗。

## 凍結的有限工程餘項與外部關卡

- 本次隱私文案及 Node-only reader 已整合，父代理在整合來源重跑 194 tests、typecheck 與非結算 browser 流程通過；不再將套用及重跑列為工程待辦。歷史交付副本及舊測試數保留於下節，現行結果以上方最終整合重驗為準。
- #22 的有界效能修補已在 `6cfce2c` 交付且父代理相同情境重驗一致，不需重建工具。雲端計量、遷移演練、50-query 計數及帳戶餘額仍待外部驗證；站內登入數不是 Cloudflare 用量。
- #20 最終版本的結算續跑仍受原核准限制，不能繞過；待適當核准後補跑。#21 已有指定本機交錯，不將所有可能排程、提交中斷電或遠端安全說成已證明；若有具體缺陷再修復，不無限擴張工程項目。
- 另列上線前外部關卡：確認信箱有人處理、適用法律及最終告知；驗真 Discord OAuth／scope／群成員、實機及正式資產路由、遠端 D1、正式 secrets/配置與部署、清理運維及備份保留。這些均非本次本機測試；沒有授權不得建立遠端資源或部署。
- 僅使用系統字型 fallback 和原創 CSS，不分發 font 檔、不導入官方素材、不加入下載授權或付費素材；素材使用條件及商標仍需人工確認。#17 角色動畫延期，不新增 blocker。

## 本次獨立副本驗證

來源 dev `77a7e8432611831d6f6a053d090a75e6946b6fce`，加本次 `public/viewer.html`、`test/privacy-reader.test.mjs` 與本文件；副本不含主 repo 的秘密、`.env*`、`.dev.vars*`、`.git`、原有 dist 或本機資料。依 lockfile 安裝依賴。全部命令在 `/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch/wuwa-issue23-delivery` 執行，dry-run 僅寫入該副本。

| 命令 | 結果 | 收據 |
|---|---|---|
| `node --test test/privacy-reader.test.mjs`（base `77a7e843` 原始 viewer） | exit 1；段落 deep equality 預期 RED | `privacy-red.log` |
| 相同命令（current viewer） | 1 pass、0 fail；原始 viewer 還原後再次 GREEN | `privacy-green.log`、`privacy-restored-green.log` |
| `npm run typecheck` | exit 0（舊版 reader 執行） | `issue23-typecheck.log` |
| `npm run build` | exit 0，Wrangler dry-run，非部署（舊版 reader 執行） | `issue23-build.log` |
| `npm test` | 192 pass、0 fail、0 skipped（156 頂層，含 1 新測試；含 dry-run build；舊版 reader 執行，更新 reader 後尚未重跑全套） | `issue23-test.log` |

reader 測試只用 Node 內建工具，針對靜態 HTML 限制性提取並驗證結構，核對實際隱私 disclosure 的完整段落、標題與 mailto；不支援的 markup 或 entity 會使測試失敗，不等同通用 HTML parser、真瀏覽器或輔助科技驗收。#22 基線完整來源與情境另見 scratch `issue22/docs/issue-22-capacity-evidence.md`；歷史結果的原始快照、測試包裝及未計成本不可省略。未操作主 repo dist 或 19481，未 stage、commit、push、部署或更動 tracker。
