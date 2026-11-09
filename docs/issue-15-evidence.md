# Issue #15 正常結算：本機核心證據與限制

此分支提供本機 API／資料核心、主播結束／續跑 UI 與隔離合成瀏覽器驗收；**不是整票正式驗收**。沒有實際 Discord、遠端 D1、部署、實機或 #18 取消恢復。#14 證據是其交付時的歷史狀態；此處才描述 #15 本分支。

## API 與提交語義

`PUT /api/activities/{activity-id}/settlements/{key}`：同源 session、CSRF、精確場次，body 僅 `{"rule_version":1}`；key 為 1..128 個英數、底線或連字號。以登入本人為 owner，管理員不因此取得代操作權；原 owner 停用後仍可呼叫。回 `200 {"status":"settled"}` 代表全部完成，`202 {"status":"settling"}` 代表尚未完成，呼叫者須以相同場次重試；`500` 可能是提交結果未知。所有有效 key 均收斂同一場結算（key 不另存，冪等單位是 activity）；不會影響新場。`GET /api/activities/{id}/status` 讀精確場次，`GET /api/activities/current` 在 settling 時只回安全的是否處理過批次，不回 cursor、觀眾 ID 或私人分數。觀眾 self 在結算中只額外回場次狀態。UI 在同分頁 sessionStorage 保存原場和 key；不將 202 或未知回應當成功，先精確讀原場，明確按繼續才送同 key；最後再讀回 settled 才解除並開放新場。原 pending 的讀取失敗不會被新場清除。沒有原分頁紀錄時，owner 可從 current 的 settling 場手動建立續跑 key；關閉分頁與多分頁不保證保留原 key，但服務端按場次冪等。

D1 batch 原子提交 open/paused → settling 與 journal；原子圍欄使後提交的報名、退出和抽選被既有 SQL 條件拒絕；圍欄之前已提交的結果被計入。journal 記錄是否已有持久 draw、處理游標及完成時間，無 draw 直接完成且不更動分數。否則依目前該 owner 的全部 `viewer_scores` 與本場全部 `registrations` 的 viewer ID 合併排序，逐頁處理：registered +1（上限 10），winner/withdrawn 不動；有分且完全未報名者 -1（下限 0）。不從 draw 快照或開場基準推測名單，也不修改 baseline。

每頁最多 100 個 ID，3 條寫入 SQL、cursor CAS 和最後 session 驗證同屬 D1 batch 原子提交；並發處理舊 cursor 時整批不再改值。fence、journal 建立、每頁加減分與 cursor、完成及釋放占位的每條寫入均以精確 session hash、owner 及 `expires > unixepoch()` 檢查；等於 SQLite 當秒即過期，與既有登入檢查的嚴格大於語義一致，不使用請求開始時的 JS 時鐘。batch 最後再檢查並於失效時觸發 SQL error 回滾，避免批內跨過過期秒造成部分寫入；此時回 500（結果須重讀），不宣稱是特定登入錯誤。journal 不綁死舊 session，同一 owner 新登入可用原場原 key 繼續；本人停用仍可結束。每請求最多處理 10 頁，這是運算分頁而非資料上限；剩餘資料保留 settling、由後續請求續跑，直到無剩餘資料才原子完成並釋放場次名額。每頁 ID 作單一 JSON 參數，SQL bind 與 batch 陳述數不隨全體歷史數增加；仍需 #22 評估真實 D1 讀寫、SQL 掃描、CPU、交易與容量，不能將 100/1000 稱產品容量承諾或全面負載驗收。

既有 `migrations/0004_activities.sql` 已將持久 `viewer_scores.score` CHECK 在 0..10，本次 0013 僅新增 journal 表，不重建表或修改舊數據；既有 CHECK 不會被 migration 偷偷繞過或裁剪舊值。原 schema 的 CHECK 僅對區間負責，非新加整數型別強制。

## 可重現證據

在下述隔離來源副本內使用 `TMPDIR` 指向副本 `.scratch`（勿在可能正在供應預覽的原 repo 執行 build）：

- `npm run typecheck`、`npm test`（包含 wrangler dry-run）、`npm audit`、`npm audit --omit=dev`；最終總數見本次執行輸出，不把 #14 歷史 107 當本次數字。
- `node --test test/settlement*.test.mjs`：本機 workerd／D1、真 production Worker 路由，包含多鍵／同鍵並發 HTTP、末抽後報名、winner／退出、歷史名單外缺席、跨主播、無有效抽選、停用收尾、CSRF／管理者，以及兩場封頂後第三場缺席 10→9。
- `settlement-interleave.test.mjs` 以測試專用 binding 包裝，在實際 D1 fence 或 draw/page batch 提交邊界之前／之後，呼叫真 router 進行報名、退出、抽選及另一結算；也驗證抽選讀取後結算先提交時遲到 draw 不會提交。這是指定邊界交錯，不是所有網路排程或遠端 D1。
- 同一測試在 fence、已 settling 且 120 個歷史分數的分頁、及完成 batch 之前，真實刪除 session 或令 `expires=unixepoch()`；核對分數、cursor、completed_at、狀態和同 owner 開場占位不變，再直接插入同 owner 的新合成 session、用同 key 續跑並重送確認僅處理一次（此特定測試不走 OAuth 登入流程）。fence 到期測試先跨過一秒，避免舊 JS 時鐘意外等於 SQL 時鐘掩蓋問題；另用真 D1 trigger 於首條分數更新中令 session 到期，驗證最後檢查造成整批回滾，再移除 trigger 確認可續跑。這些是合成精確邊界，不是全排程證明。
- 在第二頁的扣分 SQL 以本機 D1 trigger 強制失敗：同批第一條加分回滾、前頁已提交保留、cursor 與場次保持 settling 並阻止開新場；移除故障後重試，兩頁均只處理一次。1101 個歷史分數測試證明跨請求未截斷。
- `settlement-restart.test.mjs` 在收到 202 後 graceful 重建本機 runtime，持久 cursor 繼續到完成；不是提交進行中斷電、SIGKILL 或遠端 D1 驗證。`settlement-migration.test.mjs` 從 0012 實資料執行 0013，核對既有分數、基準、報名、defaults、proof、draw 與 snapshot 未變及分數區間 CHECK。

## 隔離驗證與瀏覽器收據

最後驗證副本為 `/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch/wuwa15-session-final`：排除 `.git`、`.wrangler`、`dist`、`node_modules` 與本機秘密後複製來源，另複製（不是共用 symlink）依賴；`TMPDIR`、`XDG_CACHE_HOME`、`WRANGLER_HOME`、npm cache 均在副本 `.scratch`，所有建置和測試命令 cwd 是副本。`npm run typecheck`、`npm test`（含 dry-run build）、`npm audit`、`npm audit --omit=dev`：133 tests pass、0 fail；兩次 audit 均 0 vulnerabilities。各輸出保存在副本 `.scratch/{typecheck,test,audit,audit-production}.log`，原缺陷 RED 是 `red.log`，移除最後交易檢查的對照 RED 是 `partial-red.log`，修復後 `green.log`。先前只讀檢查 19481 當時未發現 listener；沒有啟停或復原它，也不能推斷更早 root build 是否覆寫過曾供其服務的 dist。本次修復沒有在原 repo 執行 npm test、build 或覆寫 root dist。

最終審查重新在獨立副本 `/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch/wuwa15-final-verify-1794228855` 執行上述四項：133 tests pass、0 fail，兩次 audit 均 0 vulnerabilities；`npm test` 內含 Wrangler dry-run，輸出位於該副本 `.scratch`。本次重跑後僅更新此證據文件，未修改受測程式或測試。

最後程式版本的 Ego、本機 19791、隔離 D1 與假 Discord：觀眾 300、301 實際登入報名，300 退出，合成 fixture 加入 302 及歷史分數並補 1100 筆跨頁資料；抽到 301，結算後 300 保持 3、301 歸零、302 6→7、未報名 303 7→6。首個 PUT 在 Worker 回 202 後截斷本文，第一次原場 GET 強制 503；畫面保留原活動及 key，沒有開場或自動重送。重整後精確讀回原場 settling，鍵盤 Enter 明確繼續，同一 URL 第二次 PUT 為 200；精確 GET settled 後才開放新場。新場停用主播後仍可透過 UI 完成無 draw 結算，1104 筆分數的排序摘要前後一致。390 CSS viewport 實測 `innerWidth=clientWidth=scrollWidth=390`；見[最後合成收據](evidence/issue-15-browser/session-final-receipt.json)與[畫面](evidence/issue-15-browser/session-final-390.png)。

同次瀏覽器另注入舊 pending open 與失敗的原場讀取，確認開場和重試按鈕均隱藏；另以 fixture 直接建立 settling/journal，再放入未知 draw 的 sessionStorage，確認無舊 settlement key 仍可按繼續並讀回完成。此兩項是明確合成邊界，不是真多分頁排程或完整故障覆蓋。HTTP 讀取之 `app.js`、`viewer.js` 與副本檔案逐位元比對相同。之前的 `receipt.json`、`settling-390.png` 和 `final-smoke.json` 為歷史證據，不替代本次結果。Chromium 模擬窄視窗與基本鍵盤操作不等於手機、真 Discord 或遠端 D1。

重現：在隔離副本先 `npm run build`，設定 `TMPDIR` 指向副本 `.scratch`，以 `WUWA_VIEWER_QA=1 WUWA_MANAGEMENT_QA=1 WUWA_STATUS_QA=1 WUWA_DRAW_QA=1 WUWA_SETTLEMENT_QA=1 WUWA_FIXTURE_PORT=19791 node test/browser-fixture.mjs` 啟動新 fixture；確認 `FIXTURE READY` 後另執行 `ego-browser nodejs < test/browser-settlement-qa.mjs`。腳本中的 TaskSpace 名稱與兩個絕對輸出路徑需按環境調整；測試後停止自己啟動的 fixture。測試控制僅在 loopback 顯式 opt-in，所有上游均合成或拒絕。

## 剩餘

#18 取消與正常結算互斥的完整取消實作、#22 容量及真實 Discord／遠端 D1／實機測試皆未完成。尚未做結算批次提交中途強制終止或遠端故障注入；graceful restart 不等同上述測試。沒有部署或操作遠端 D1。
