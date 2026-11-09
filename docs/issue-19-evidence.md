# Issue #19：本機歷史清理及限制

## 範圍與操作契約

`POST /api/admin/history-retention` 僅允許設定的 `ADMIN_DISCORD_ID` 登入者，沿用同源 Origin 與 CSRF 檢查；body 僅 `{"owner_id":"<數字主播 ID>","dry_run":true}` 或 `false`，不接受指定場次、使用者或時間。預檢不寫入，回傳該主播合格場次數 `eligible`；實際執行一次最多處理一場、每個子表各最多 100 列，回傳本次完成刪除場次數 `deleted`、處理後 `eligible` 和 `has_more`。`has_more:true` 時重新呼叫直到 false；`deleted:0` 不一定表示無進度，可能剛完成部分頁面。計數是各自 SQL 時點的觀察，不是跨請求固定快照。管理者可指定任何主播以執行政策清理，但 API 不回傳該主播名單或私人內容；主播、訪客及未設定的其他身分無權呼叫。沒有自助刪除 UI/API、排程或自動啟用。

以 SQLite `unixepoch()` 判斷正常結算 journal 或取消恢復 journal 的 `completed_at < unixepoch()-7776000`；**剛好 90 天尚不清理**。兩種 journal 的完成時間與終態變更在同一 D1 batch，只有 `settled`／`cancelled` 才合格；`initializing`、`open`、`paused`、`settling`、`cancelling` 永不合格。沒有完成 journal 或完成時間未知的舊資料不推測、不清理；0018 不改舊行。測試用直接 SQL 改合成 fixture 的完成時間，生產 API 沒有注入時間參數。

第一頁同一個 D1 batch 建立永久 `activity_tombstones`（僅 UUID、主播 ID、終態與完成時間）並刪第一頁；尚有子資料時保留終態場次及 journal 供續跑，全部刪完同批刪 journal 及場次。每頁末尾再次檢查管理員 session，失效或任一 SQL 失敗則整頁回滾。UUID tombstone 的資料庫 trigger 全域阻止重用，即使其他主播傳入；開場 generation 仍按原邏輯保留。完成清理後延遲結算／取消為 404、抽選及報名拒絕，不能復活或轉投新場；不保留每抽 key 或私人名單。清理尚未完成期間原終態重試可回原終態，不重新結算。停止後重試、已提交頁面及失敗頁面不需要人工修復 cursor。

## 資料分類

- 刪除：該場 `registrations`（包含名稱快照）、`draw_candidates`、`draws`（winner、名稱與 request key）、`activity_score_baselines`、終點 journal（含 cursor）、場次及規則快照；亦清除該場 `guild_membership_proofs`、`viewer_login_intents`、`viewer_oauth_context` 和對應 OAuth state。先刪候選再刪 draw，明確按活動及主播範圍，不靠跨表同 ID cascade。
- 保留：`viewer_scores`、其他主播資料、`activity_opening_generations`、`approved_streamers`、`environments`、`activity_defaults`、共用 `discord_identities`、session 及 `session_display_names`。共用身分可能仍含 Discord display name/username；本功能不是刪除帳號或全站身分。原有 session／登入相關 TTL 機制仍各自適用，且不是本次資料權利請求處理。
- 新版 OAuth 寫入在提交時檢查場次尚在且沒有 tombstone；0018 的資料庫 trigger 另拒絕任何指向 tombstone 的 proof／intent／context INSERT 或 UPDATE，包含舊 SQL 與跨主播 ID，不依賴新版 callback。這三表無活動 FK；其他有活動 FK 的私人子表由 FK 限制。一般 `oauth_states`、session、共用身分等不帶活動 ID，無法以 tombstone 判斷來源，且可能由已讀取 context 的舊 callback 在清理後寫入。**真實上線清理的必要 gate：先停止所有舊部署對該 D1 的寫入，排空所有舊版在途請求／callback，確認舊部署不再是 writer，之後才能開始清理。**僅部署新 worker、等到 cleanup 完成才檢查或只依賴 trigger 都不滿足此 gate；此處未聲稱任何實際部署已排空。沒有擴權或額外外部查詢。
- 到期後不會自動執行：管理者須持續操作至 `has_more:false`，所以沒有即時或固定 deadline 完成刪除的保證。永久 tombstone 僅保留 UUID、主播 ID、終態及完成時間，不含參與者名單；它仍是保留資料。共用身分及 session 可能包含私人欄位，依各自生命週期保留，並非場次歷史清理一併刪除。

## 本機測試與剩餘

測試使用合成帳號、真 workerd 與隔離本機 D1；`history-retention.test.mjs` 經 loopback HTTP 執行生產 router，另有 migration 與持久 D1 graceful restart 測試。覆蓋正常／取消完成後到期、89 天、精確 90 天、超過 90 天、未知時間及未完成狀態，管理員／非管理員與跨主播、CSRF、其他主播及分數保護、全部子表與 FK、延遲舊請求、重複清理、251 人多頁、注入刪除錯誤與 batch 內 session 過期回滾、重啟後續跑，以及 0017→0018 保留資料。graceful restart 與注入 rollback 不證明提交過程強制斷電或不確定提交結果；未窮舉所有並行交錯。

隔離副本 `cache/scratch/issue19-fence-verify/`：`npm run typecheck` 通過、`npm test`（含 Wrangler dry-run）**189/189 通過**、完整及 `--omit=dev` 的 `npm audit` 均 0 vulnerabilities；`wrangler d1 migrations apply win-wuwa-local --local --persist-to ...` 成功套用 0001–0018。新增合成測試先讀取舊 callback context、透過 Worker HTTP 清理，再以舊版 SQL shape 嘗試對 proof／intent／context INSERT、UPDATE，確認被拒絕且分數和受保護表不變；其他未退役活動 ID 仍可寫入。此為本地 workerd D1 的有界交錯證據，不是舊部署已排空或遠端 D1 驗證。兩個重疊 HTTP 清理請求不是所有 SQL 提交交錯的證明。記錄在上述 scratch 的 `full-test.log`、`typecheck.log`、`audit.log`、`audit-prod.log`、`migration.log` 與針對性 RED `red.log`（scratch 可能自動清理）。

重現：將來源複製到 profile scratch（排除 `.git`、`node_modules`、`dist`、`.wrangler`），另複製隔離 dependencies，設定 `TMPDIR` 和 `npm_config_cache` 為 scratch，執行 `npm run typecheck && npm test && npm audit && npm audit --omit=dev`；不要覆寫 repo build 或 19481 preview。

尚未驗證遠端 D1 的真實原子性、配額與大資料負載、Discord、實際裝置、provider 時鐘及平台備份/Time Travel 的物理刪除時程；無部署、遠端清理、排程或真帳號操作。合法性與隱私告知仍需正式審查。本地 row 刪除不等於供應商備份或其他裝置立即抹除。未知完成時間的舊歷史需另訂安全處理政策，不能自行以建立時間補值。
