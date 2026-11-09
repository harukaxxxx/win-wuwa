# Issue #11：本機觀眾報名切片，整票未驗收

分支 `issue-11-viewer-registration`，基於 `31460f63de62a339edc22ccbef0e3f1bde12323f`；尚未部署或使用真帳號。

## 本機實作

- 固定入口 `/s/<主播 ID>`、無場空態、主播管理頁本人連結；公開 projection 僅場次 ID、狀態、規則版本、群限制與人數。本人 API 僅回自己的序號與狀態。限制群資格驗證 #12 尚未實作，報名 fail closed。
- migration 0007 使用場次與觀眾唯一、場次與序號唯一及複合外鍵；SQL 寫入時核對確切場次、規則版本、open、主播資格與群限制。序號由現存最高序號推進，日後清理不得刪除仍需配號的記錄而造成重用。
- migration 0008 綁定 OAuth state 與所見主播、場次、規則；callback 經 code exchange 後僅返回本機固定路徑及 session 綁定、不透明的 intent，無任意 redirect。每個觀眾 OAuth state 有各自 cookie，避免多分頁覆寫。返回後必須確認，換場或換規則提示失效，不自動報名。
- 報名前將確切目標存入該分頁、該身分的 sessionStorage；送出後讀回本人狀態才顯示成功。未知結果只重讀、不盲目重送；資料不能安全儲存時不送出。
- 403/409 且本人讀回無報名時解除本次 pending；未知結果保留並提供手動解除，另存解除紀錄。同場重試依資料庫唯一鍵保持序號；舊場本人讀取提供終態證明後可明確確認新場，該動作不送出新場報名。
- 頁內隱私告知依 #5 政策敘述必要 Discord 身分、主播分數隔離、公開範圍、完成後 90 天詳細紀錄保留、分數與最小冪等資料及 contact@makinoworks.com；明確指出自動清理與法律確認尚未完成。

## 可重現的本機瀏覽器證據

README 的 19573 loopback fixture 與 `test/browser-viewer-qa.mjs`：真 Ego Chromium 以合成身分 A 登入後明確確認，序號 1、重整仍為 1；登出切換 B，事前不見 A 的序號，B 報名序號 2；登出後登入途中用 test-only SQL 換場，返回顯示失效、新場公開人數為 0。此 fixture mock 外部 Discord、資料庫臨時，不能證明真 Discord 或 Cloudflare asset routing；未使用真帳號或遠端資料。

`test/viewer-oauth.test.mjs` 使用 built Worker + Miniflare/D1 覆蓋跨 state cookie、session 所有權、舊場 intent、重放及拒絕任意返回 URL；`test/viewer-registration.test.mjs` 驗證公開精確 allowlist、匿名本人讀取拒絕、不同身分及主播隔離、舊規則、停用、群限制與並發重複報名。Promise.all 不證明實際提交邊界交錯。

`test/browser-viewer-failures.mjs` 使用隔離合成資料實際點擊驗證拒絕、恢復資格後手動報名；已提交寫入但截斷回應，第一次本人讀取失敗後保持 pending；SQL 令舊場終止並建立新場後確認新場、新場人數仍為零；另檢查群組限制提示。實測日誌顯示沒有自動重送。另以真本機 HTTP 並發停用與報名，驗證其中一個合法序列結果；測試 trigger 使插入失敗後下一序號仍從 1 起，兩人重試序號不變。這不證明兩種排程都發生，也不證明 SQL 提交邊界交錯。

## 剩餘與風險

本機正式資產路由：隔離 D1 套用 0001–0008 後，以 `wrangler dev --local` 在 127.0.0.1:19589 實測 `/s/123`、`/viewer.js`、`/style.css` 均 HTTP 200；Ego Chromium 開啟 `/s/123` 顯示「目前沒有進行中的場次」。這不是遠端 Cloudflare 部署或登入報名驗收。

真 Discord OAuth、遠端 D1、實際裝置及部署尚未驗證。停用與報名在 SQL 提交邊界的特定交錯尚未注入；序號不可修改目前依應用程式行為，尚無資料庫更新禁令。群成員驗證 #12、退出 #13、抽選 #14、結算、取消、90 天清理與法律審查均不在本切片。不可將局部通過視為整票完成。
