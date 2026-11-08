# Issue #9 本機工程證據（未完成驗收）

在 `issue-9-streamer-management` 的來源快照，以合成帳號與 Miniflare/workerd 本機 D1 執行，非部署或真 Discord 驗收。隔離目錄為 `/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch/wuwa-issue9-qa`，不含憑證、`.wrangler`、Git 或原始 dist；連結原 node_modules，所有 build 在快照執行。未停止任何既有 preview。

在原 repository 根目錄執行快照更新，接著在快照內執行：

```sh
Q=/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch/wuwa-issue9-qa
rsync -a --exclude node_modules --exclude .git --exclude .wrangler --exclude dist --exclude '.dev.vars*' ./ "$Q/"
cd "$Q"
npm run typecheck
npm test
npm audit
npm audit --omit=dev
```

先前結果：typecheck 成功；`npm test` 包含 Wrangler dry-run，22 tests / 22 pass / 0 fail；兩個 audit 均 `found 0 vulnerabilities`。新增分頁及首次核准重送測試先觀察舊實作各自失敗，再修正；用量端點先觀察 404 再修正。最新第二頁修正驗證另見下方。

- 管理 API 實際測試超過 100 筆、游標完整遍歷與錯誤查詢；首次核准後重送、停用後拒絕舊版本、明確以目前版本重核准。此為模擬丟失回應後重送，並非網路故障注入。
- 合成真實 `/auth/login` 請求使 D1 原有每日計數遞增，管理端讀到 1；非管理者 403。這只量測 UTC 當日通過原有站內登入啟動額度的請求，不是全部 HTTP 請求、不含登入成功數、Cloudflare 帳戶用量或配額。複用原有累加寫入，沒有新計量寫入；每次 usage 請求額外一次 D1 讀取（另有原先 session 身分讀取）。不紀錄使用者明細。
- 覆蓋缺失/無效管理員配置、不符身份、CSRF 拒絕與無建立、管理者本人環境與其他主播隔離、遷移前後私有環境保留、原外鍵下停用與環境寫入競態。只有原型中已存在的環境被覆蓋；其他尚未實作的場次/抽選不在測試範圍。
- 先前基本測試：隔離快照中合成 ID `123` 登入後，以 Enter 核准 `456`、點擊停用、Enter 重新核准，最終版本 3；375×812 模擬不是實體手機。清單不是變動期間一致快照，須重新讀取才能看見游標前新增項目。
- 真 Discord、正式 Cloudflare 資源與配額、真手機、獨立程式審查與部署未驗證；#8 的真 Discord 缺口仍存在。無 commit、push、遠端或真帳號寫入。

## 最後審查修正

首次核准的 PUT 未進 Worker 時，精確 GET 404 表示目前不存在：顯示「目前尚未核准」、解除未知鎖，僅由使用者明確重新送出；既有目標 404 同樣顯示不存在並移除過時列。PUT 回應中斷後即使狀態及版本符合，也只顯示權威目前狀態，不歸因於本次操作；收到完整成功回應後仍需精確讀回。`test/browser-management-qa.mjs` 的 opt-in loopback fixture 含一次寫入前阻斷與寫入後截斷回應，供瀏覽器重現。首次 404 修正前曾在該測試觀察等待「目前尚未核准」逾時。共用 Cloudflare 配額監控留待 #22，站內 UTC 登入計數不是 Cloudflare 配額。真 Discord 與後續 session 整合仍是待驗關卡。

## 第二頁精確讀回（隔離合成驗收）

管理 GET 精確讀回目標；非管理者 403、匿名 401、缺少 404，錯誤 query 400。PUT 無回應後只讀目標、不重送；讀取失敗顯示未知並停用其他管理控制，提供精確目標重讀。已載入頁保留，管理請求序列化。測試新增前先在真 workerd/D1 看到 404 而非預期 400 的 RED。最新快照完整 typecheck、dry-run/test 23/23、完整及 production-only audit 均通過且 0 vulnerabilities。

以 loopback-only fixture 開啟 `WUWA_MANAGEMENT_QA=1`，種 106 筆合成資料、Ego Chromium 登入並載入第二頁；目標 `10104` 由版本 1 停用至 2，再以鍵盤 Enter 重核准至 3。fixture 等 Worker 實際完成 PUT 後送出部分回應並中斷，UI 以 GET 確認版本 4；下一 PUT 真實完成後讓目標 GET 回 503，UI 顯示未知並禁用操作，點重讀後確認版本 5。比對其餘 105 筆完全不變。另一次在回應標頭前中斷的實驗中，Chromium 曾自動重送 PUT 並收到 409；CAS 防止重複版本變更，UI 保守顯示未確認，不把 409 說成成功。這是瀏覽器傳輸層行為，不能聲稱所有網路層均不重送。此為可控 loopback 故障注入，不代表真網路或真 Discord。截圖存於快照 `unknown.png`、`page2-final.png`，為臨時驗收檔。

重現（在 repo 根目錄；不得使用舊 LAN 19481 preview）：

```sh
Q=/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch/wuwa-issue9-lifecycle
mkdir -p "$Q"
rsync -a --exclude node_modules --exclude .git --exclude .wrangler --exclude dist --exclude '.dev.vars*' ./ "$Q/"
ln -sfn "$PWD/node_modules" "$Q/node_modules"
cd "$Q"
npm run typecheck && npm test && npm audit && npm audit --omit=dev
WUWA_MANAGEMENT_QA=1 WUWA_FIXTURE_PORT=19594 node test/browser-fixture.mjs
# 另開終端；同一新啟動 fixture，每次重新啟動資料重置
ego-browser nodejs < "$Q/test/browser-management-qa.mjs"
# 測完停止自己啟動的 fixture
```

管理 QA fixture 僅 opt-in 且 loopback 生效；其控制端點與資料均只在 test harness，不存在 production Worker。瀏覽器使用 synthetic OAuth；不將該結果當作真帳號或裝置驗收。
