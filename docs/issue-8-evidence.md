# Issue #8 本機原型證據（非完整驗收）

## 2026-11-09 提交前隔離重驗（目前）

- 使用獨立來源快照與 `npm ci`，執行 `npm run typecheck`、`npm test`（含 Wrangler dry-run build）、`npm audit`、`npm audit --omit=dev`：15 tests pass、0 fail、0 skipped，兩種 audit 均 0 vulnerabilities。LAN fixture 測試使用獨立埠，未停止或覆寫既有預覽。
- 重新查核下列 Cloudflare 與 Discord 官方文件及 server metadata；真 Discord 與遠端部署仍未驗證。

## 2026-11-08 review 修正後

- `npm run typecheck && npm test && npm audit && npm audit --omit=dev`：typecheck 成功；dry-run build 成功；13 tests pass、0 fail；兩種 audit 均 0 vulnerabilities。直接開發依賴 Miniflare 從 4.20260730.0 改為 5.20261104.0-beta（與既有 Wrangler 4.158.0 所用版本一致），測試使用官方 v4 options 轉換器；沒有 force 或降版。舊的 3 high 及下方 7 tests 為歷史結果。
- RED：`npm test` 在修正前對 JSON null 得 500（預期 400）；清理測試在實作前發現過期 session 未清除。現測試包含 null、array、primitive、無空格 cookie。
- 寫入 INSERT/UPDATE 的同一 SQL 內包含核准 EXISTS；`test/revocation.test.mjs` 使用 Miniflare D1，核准讀取後受控刪除合成核准，INSERT 不寫入、UPDATE 回 409 且原值與 version 2 不變。測試在 Node 執行建置後 handler 並代理 D1，並非 workerd 真實排程競爭。UPDATE 初次執行斷言失敗：現有外鍵阻止刪除仍有環境資料的核准；為測試條件 SQL，僅該測試的臨時 schema 移除外鍵，正式 schema 和撤權政策未變。這是測試設置限制的 RED，不是產品修復的 RED。
- Miniflare `Log` 與 structured log sink 收集合成 provider 八種錯誤（token/user redirect、malformed、無效資料及兩端 transport failure），掃描回應 header/body 和 runtime logs，包含 secret、access/refresh token、code、每次 verifier；獨立 console probe 驗證 sink 可收到 workerd console，dispose 後再掃描。transport exception 含合成值，沒有印出請求內容；測試記憶體內收集 fixture，不代表真 provider 或完整生產日誌管線。
- persistent D1 先經 dispose/recreate 測試正常重啟；另以子進程收到 HTTP 寫入成功且值/version 確認後 IPC 回報，父進程 SIGKILL，另一進程以 HTTP 讀回相同值/version、舊版本重送 409 且再次讀回不變。僅證明本機已確認提交後的強制中斷恢復，不證明提交中途或未知結果、遠端 D1、系統斷電恢復。
- 新 migration 設每日 1000 次登入啟動 SQL 預算、state/session 各 1000 筆上限，登入時最多各清理 100 筆過期資料；此為原型內部保護，不是已核准的產品限額。達上限可造成合法使用者被拒，不能宣稱完整抗 DoS。未驗證 distributed D1 或生產負載，既有本機資料庫須重新執行 README 的 local migrations。
- 尚未完成：真 provider/裝置人工驗收、生產 log 管線及未知提交結果恢復。沒有部署或讀真 secret。#8 真 Discord 人工驗收 gate 保持未完成。下方「執行與結果」保留原始歷史，若與本節衝突以本節為準。

## 真瀏覽器、本機合成 provider 驗收

- `npm run build && node test/browser-fixture.mjs`；以 Ego Chromium 開啟 `http://localhost:19481/`，點畫面登入、輸入 `合成瀏覽器驗收 — synthetic 8`、點儲存、重新載入、點登出。所有資料皆合成，獨立暫存 D1 僅 seed 合成核准 ID `123`。瀏覽器實際持有 `__Host-session` 與 `__Host-csrf`，CDP 顯示 Secure、HttpOnly、SameSite=Lax；cookie 值未記錄。
- 實際 HTTP 序列：匿名 session 401；`GET /auth/login` 302；合成 authorize 302；`GET /auth/callback` 302；session 200；environment 初讀 200 `{"value":"","version":0}`；`PUT /api/environment` 200 `{"value":"合成瀏覽器驗收 — synthetic 8","version":1}`；重讀及頁面 reload 後讀取均 200 且 value/version 精確相同；`POST /api/logout` 204；session 和 environment 均 401，畫面回到登入連結。截圖：[儲存](evidence/issue-8-browser/saved.png)、[登出](evidence/issue-8-browser/logout.png)。
- 範圍：built production Worker 與原始 public 資產經 test-only ASSETS service；harness 僅改寫授權 302 至本機頁，從原始 authorize URL 取 state 及 redirect URI 並回傳合成 code/iss；outboundService 只回合成 token/user 或拒絕，沒有真 Discord 連線、真憑證或 production 認證修改。不證明真 provider 相容、Cloudflare 生產 assets routing、部署、真裝置或正式核准政策；未在此次瀏覽器測試未核准身分，既有 runtime 測試另覆蓋 403。

查核日期：2026-11-08，Asia/Taipei。Node v22.23.1、npm 10.9.8、Wrangler 4.158.0、Miniflare 4.20260730.0。所有身分、密鑰、Discord 回應及環境文字為合成測試資料，沒有讀取真實憑證、建立遠端資源、部署或啟用付費。

## 官方資料

- [Workers 價格](https://developers.cloudflare.com/workers/platform/pricing/)：免費 Worker 每日 100,000 requests、每次 10ms CPU；直接靜態資產請求免費不限量。D1 每帳戶每日 500 萬 rows read、10 萬 rows written、總儲存 5 GB、10 databases；索引可能增加寫入。免費每日額度 00:00 UTC 重置，共用而非每主播獨立。[D1 免費額度強制執行](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)：達到讀寫額度後查詢失敗；不能承諾持續可用。尚未量測本帳戶實際用量或容量。
- [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2)：authorization code、server-side form exchange、精確已註冊 redirect、state 綁定使用者請求，identify 可讀 `/users/@me` 而不需 email；回傳 `iss=https://discord.com`。該文件建議 code grant 搭配 PKCE；[官方 server metadata](https://discord.com/.well-known/oauth-authorization-server) 明列 `code_challenge_methods_supported: ["S256"]`。程式使用 S256，但真實 provider 未測，不能以 fixture 證明 Discord 是否接受本機 redirect 或完成整合。只在交換期間持有 access token，不儲存 access/refresh token；尚未向 Discord 撤銷授權。
- [D1 batch 官方契約](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)：同一 batch 順序執行，某 statement 錯誤回滾整個 batch；非跨 HTTP 請求或 Discord 的分散式交易。此原型的條件 `UPDATE ... WHERE version=? RETURNING` 提供單列 CAS，主鍵／CHECK 提供約束；尚不證明抽選、終點、清理或遠端故障情境。

## 執行與結果

- RED：`npm test`（建置後 workerd 實際 HTTP seam），匿名 GET `/api/environment` 預期 401、實際 404，1 fail。初始安裝曾因不存在的 workers-types 版本 ETARGET，改用 npm registry 現行版本後成功。
- GREEN：`npm run typecheck && npm test && npm run build && npm audit --omit=dev`：typecheck 成功；7 tests、7 pass、0 fail；Wrangler dry-run build 成功（無部署）；production-only audit 0 vulnerabilities。測試是在 built Worker + Miniflare/workerd + 每次獨立本機 D1，外部 Discord HTTP 完全攔截的合成 fixture。涵蓋匿名拒絕、state 偽造/重放/過期、S256 challenge 對應 verifier、scope、精確 redirect、cookie 屬性、CSRF、非核准拒絕、兩合成身分隔離、同版本並發 CAS 一勝一衝突、重送舊版不再寫、D1 主鍵衝突、batch 約束失敗全部回滾、登出與基本 secret 不出回應。重送舊版模擬回應遺失後重試，**沒有實際中止 workerd、注入進程崩潰或驗證未知提交結果的自動恢復**；此窄路徑回衝突後需讀回，非通用冪等恢復。
- `npx wrangler d1 migrations apply win-wuwa-local --local`：本機 `0001_init.sql` 成功，5 commands；沒有遠端 migration。
- `npm run dev -- --port 19387`，loopback 實測 curl：`/` 200、匿名 `/api/environment` 401、未配置 `/auth/login` 503；Ego Chromium 畫面可見標題及登入連結。真實瀏覽器登入與存讀未驗證。測試伺服器已停止。首次嘗試 8787 已有其他服務佔用，未停止或修改它。
- `npm audit`：3 high（開發依賴 miniflare、sharp、undici），不等於 production-only 0 的風險已解決；本機工具/建置鏈仍須在對外使用前解決並重測。沒有使用 `npm audit fix --force`。

## 未完成及安全界線

這不是 #8 或 AC-18 完成宣告。沒有真 Discord app/redirect/credentials、真 provider code exchange、部署與遠端 D1、未知提交結果恢復、正式資格授權政策或帳戶共享額度實測。合成瀏覽器、upstream redirect 與本機 runtime log 的驗證範圍見目前段落；不等於生產 log 管線或完整安全審計。未使用真實敏感資料。

歷史限制（已部分改進，見目前段落）：原本 OAuth state 無上限且未清理；目前仍缺完整抗 DoS、監控和正式營運保護。缺乏真實 provider 驗證及威脅模型以前，不可公開或部署。`approved_streamers` 僅是隔離測試前置資料，無自動授權，並不實作或預決 #2 初始管理者及核准流程。Cookie 設 `Secure; HttpOnly; SameSite=Lax`、雙重狀態與 Origin/CSRF 防護；這些局部測試不是完整安全審計。
