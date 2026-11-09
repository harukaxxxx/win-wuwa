# Issue #14 抽選核心：本機證據與限制

本分支含 API／儲存及序號揭曉 UI，本機合成資料驗收，非整票或正式環境驗收。未部署、未操作真帳號或遠端 D1。根據 #10 保留的 `activity_score_baselines`，本次只歸零 winner 的該主播分數；候選快照另存抽選當時分數，兩者不是同一基準。#15 結算及 #18 取消補償仍未實作。

## 設計

`PUT /api/activities/{activity-id}/draws/{request-key}` 主播同源 session + CSRF，body 僅接受 `{"rule_version":1}`；`GET` 同路徑依主播與原 key 讀取。結果僅含原序號、規則版本及時間，沒有候選者 ID、Discord 資料或未中者聯絡資料。重試相同 key 讀已提交結果，不受後來停用／終態影響；新 key 只有 approved 且 open/paused 可提交。空集合不寫 draw。目前無 winner 顯示名稱儲存，UI 僅顯示伺服器讀回的報名序號；主播聯絡功能屬 #16，未實作。

主播頁將不可變的場次、規則與 key 存入該分頁 `sessionStorage` 後才送出；成功或未知皆 GET 精確 key 確認，確認後保留 key 供重新整理讀回。只有再次明確按「抽選」才建立新 key。未確定結果的 404 不會解除圍欄或重送；確定收到拒絕且立即精確 GET 404 才清除。舊場待確認不套到新場。此儲存沿用現有分頁模式，不保證關閉分頁、跨分頁或清除瀏覽器資料後恢復，也不提供跨分頁互斥；應避免同時操作多分頁。

新分頁可由本人 GET `/api/activities/{id}/draw-results/latest` 顯示該場最近已提交結果，不會抽選；它不能辨認關閉舊分頁時仍在途的未知請求，也不能保證恢復其原 key。關閉分頁或多分頁時不具完整未知操作恢復保證；應先在原分頁確認，避免重新抽選。

D1 batch 第一條 INSERT 直接在提交時比較整個 registered 候選集合的數量、ID、原序號及主播分數；同時核對精確場次、規則、主播狀態和有效 session。後續快照、winner 狀態及 winner 分數歸零只在該次隨機 draw ID 存在時執行；整 batch 失敗回滾。候選、分數或停用在讀取後先提交會使比較失敗並重新讀取；最多重試五次，之後用同 key 由呼叫者重試。候選結果以 draw ID 關聯；同場 winner UNIQUE，request key 在場次內 UNIQUE。報名序號只在首次新增時計算，退出／中獎不改序號；現有 registration handler 額外阻止超過 JS 安全整數。尚無 DB 層禁止手動修改 ordinal 的 trigger。

規則 1 以 1/2 均勻選取、1/2 加權選取實現原公式；後者均勻提案後以 `w/6` 接受。`w=(5+2*score)*(ordinal+59)/(5*(ordinal+49))`，分子及分母使用 BigInt 精確比較，拒絕抽樣的整數不取模；來源為 `crypto.getRandomValues`。score 0..10、ordinal >=1 時 `1 < w <= 6`（有限序號），故每輪加權提案接受率大於 1/6，但隨機演算法無確定的最壞迭代次數；安全序號上限下 BigInt 避免乘法溢位。保存的 weight/probability 為顯示用浮點近似而非抽籤依據。例：序號 1、分數 0 與序號 51、分數 10，權重 1.2 與 5.5，機率約 0.33955223880597013 與 0.6604477611940298。

## 執行與範圍

以 `TMPDIR=/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch` 隔離暫存：

- `npm run typecheck`；`npm test`（含 wrangler dry-run；詳細測試數以本次工具輸出為準）；`npm audit --omit=dev`；`npm audit`；`git diff --check`。
- `node test/draw-simulation.mjs > docs/issue-14-simulation.json`，再次執行與文件 `cmp` 相符。固定種子僅用於測試模擬，不提供 production seed 或指定 winner API。10,000 個互相獨立合成場次、每場 3 抽、12 位初始 score 固定，不模擬場間結算或持續分數；不得把模擬當成真環境公平性證明。
- `test/draw.test.mjs` 實際 Worker/D1 HTTP：同鍵、不同鍵重疊，退出先與中獎先、paused、停用、權限、CSRF、其他主播分數不變及投影。
- `test/draw-interleave.test.mjs` 以僅測試 bundle 包裝真 Worker 的 D1 binding，在讀候選後注入新報名、退出、分數變動及停用；另在真 batch 尾端注入 CHECK 失敗，觀察整批無半成品。也在 B 首次同鍵查無結果後，讓 A 真正提交，再分別注入停用、終態或空候選，確認 B 讀回同一結果。這是指定邊界交錯，並非所有 SQL 排程、遠端 D1 或真網路驗證；注入鉤子不在 production worker。
- `test/draw-restart.test.mjs` 驗證已回應成功後 graceful restart、相同 key 保留同一結果。`test/draw-kill.test.mjs` 實際 HTTP 進入本機代理及 production Worker/workerd/D1，Worker 回應完成後、代理送任何 HTTP response 前 SIGKILL 代理進程；重啟同一持久資料，GET 與同 key PUT 取得原結果，draw 一筆、winner 一人、快照兩筆、winner 分數歸零而另一分數不變。此為**已提交後、HTTP 回應前**強制終止，不是 SQL 提交中途斷電或遠端 D1 證據。
- 最新隔離快照 `npm run typecheck` 和 `npm test`（107 pass、0 fail）；`npm audit --omit=dev` 及 `npm audit` 均 0 vulnerabilities。測試使用 profile scratch 的 `TMPDIR`，dry-run build 在獨立快照；未觸碰 19481 preview 程序或 build 輸出。
- Ego Chromium、loopback 19718、合成 OAuth 及真 production public assets/Worker/D1：觀眾 300 報名序號 1 後退出，301 報名序號 2；主播暫停後抽選。fixture 在 Worker 提交後截斷已發送部分 HTTP body，並讓第一次精確 GET 503；畫面顯示未知，按確認後及 reload 均讀回序號 2。記錄為同 key 1 次 PUT、3 次 GET、1 筆 draw；序號 1 仍為 withdrawn、序號 2 為 winner（候選快照排除另由上述 HTTP/D1 測試驗證）。301 登入後顯示已中獎且隱藏退出，實際 POST 退出回 409。這是合成身分、本機 fixture 和桌面 Chromium，不是實際 Discord、正式環境或實機驗收。

## 未完成

尚無 owner 聯絡 winner、顯示名稱、公開 winner 投影、實際 Discord、遠端 D1 或實體裝置驗收；#13 的抽選整合仍需完整產品驗收後才能結案。無遙測或負載驗證證明大型候選 JSON/單批 D1 容量。未部署。
