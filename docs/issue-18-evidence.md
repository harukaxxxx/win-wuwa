# Issue #18：取消恢復本機核心與 UI

本分支包含 API／資料核心及主播取消／續跑 UI，已完成隔離本機測試與最後版合成瀏覽器流程；未部署、未操作遠端 D1 或真實帳號。真 Discord／實機仍待驗收；#19 歷史清理不在本批。

## API 與資料

`PUT /api/activities/{activity-id}/cancellations/{key}`：登入本人、同源及 CSRF，body 僅 `{"rule_version":1}`；key 為 1..128 英數、底線或連字號。停用主播仍可取消自己的 open／paused 場。`200 {"status":"cancelled"}` 為全部完成；`202 {"status":"cancelling"}` 須重試；`500` 為未確定結果，先精確查該場狀態。同場不同 key 依 activity 收斂；settling／settled 不能取消，cancelling／cancelled 不能正常結算。

取消與結算競爭同一活動狀態 SQL 圍欄。每頁最多 100 位 winner，cursor CAS 與分數在同一 D1 batch，最後 session 檢查失敗令整批回滾；fence、每頁、完成放位皆檢查本人 session 有效。完成前仍佔 slot。只補償本場 winner，依開場基準恢復，沒有基準列即為 0；不以抽選候選快照覆寫基準，也不對未中、退出或缺席者做結算。測試以直接 SQL 合成開場後、抽選前加分，證明恢復開場 0；目前沒有合法的獨立加分 API，該情境不是可用產品功能。歸零後若分數已非零則不覆蓋；此值相等保護不是版本圍欄，無法辨識外部直接 SQL 將 0 寫成 0 或其他未來 writer 的來源。未定義或宣稱未來 writer 的政策。

保留抽選、候選、報名與名稱快照及資格證明；結果依活動狀態標記無效，公開 winner 投影不再包含 cancelling/cancelled 場，私有 draw 讀取回 `invalid:true`。取消不暴露私人聯絡資料。

## 本機證據與限制

隔離副本最後版 `npm run typecheck` 通過；`npm test`（含 Wrangler dry-run build）：179 passed、0 failed；`npm audit` 與 `npm audit --omit=dev` 均為 0 vulnerabilities。完整輸出在 profile scratch `issue18-final-verify/`。開場無基準但 fixture 於抽選前加分的回歸，修正前實測 RED（8 != 0），修正後 GREEN。

隔離 source copy 下以真 workerd、完整 migration、隔離 D1 與 HTTP 執行 `test/cancellation*.test.mjs`：包含停用與 paused、新人 0、跨主播、正常結算互斥、故障批次回滾、1101 歷史分數／205 winner、不同 key 重試及原場延遲請求、新場空名單／重新群資格／序號 1。獨立 migration 測試比較 0016 前後分數、基準、名字、資格、設定和另一主播；graceful restart 測試使用 1101 winner、202 已確認游標後重建 runtime，再完成恢復。

`cancellation-interleave.test.mjs` 在真 D1 batch 提交前後透過真 router 指定結算／取消雙序、抽選與報名、退出兩側，以及 fence/page/finish 前 session 撤銷或到期；page 內以 trigger 到期證明整批回滾。這是指定提交邊界交錯，不是所有網路排程，也不是遠端 D1 證據。graceful restart 並非 SQL 執行途中斷電或 SIGKILL-after-commit 的驗證；本批沒有做上述取消專屬測試。

重現：把 repo source（排除 `.git`、`node_modules`、`dist`、`.wrangler`）複製到 profile scratch，複製獨立 `node_modules`，在該目錄設 `TMPDIR` 與 `npm_config_cache` 指向 profile scratch，執行 `npm run typecheck && npm test && npm audit && npm audit --omit=dev`。勿覆寫原 repo `dist` 或既有預覽程序。

## UI 與瀏覽器證據

取消確認明確區分正常結算，說明本場抽選結果無效、補償本場抽選分數變動而不加分或扣缺席分；停用本人仍可操作。同一分頁的 sessionStorage 保存原場 UUID、規則及 key；202 或回應中斷均不當作完成，精確查回後手動續跑，只有讀到原場 cancelled 才清紀錄。開始取消與正常結算互斥，未完成期間開場、抽選與狀態變更受限制。私有歷史標記無效並保留聯絡欄位，公開結果由 API 排除取消中及已取消場；遲到抽選讀取由 generation 避免覆蓋取消後畫面。自動測試涵蓋原場 unknown／202、舊場 pending 不作用新場及同場遲到回應。

中間版本 Ego Chromium、loopback 19839、合成登入和真 Worker／本機 D1：300 報名並以分數 7 抽中歸零；另外以 fixture 插入 1001 筆合成 winner、歸零分數及基準以跨頁。首個真取消 PUT 回 202 後截斷本文且首個精確 GET 為 503；重整後保留原 UUID 和 key，390 CSS px（innerWidth/clientWidth/scrollWidth 均 390）以鍵盤 Enter 手動續跑同 URL，200 後精確讀回 cancelled；300 分數恢復 7、301 保持 4、1001 筆恢復 5，公開 winners 為空，新場空名單，停用本人取消無抽選新場後分數不變。[中間收據](evidence/issue-18-browser/intermediate-receipt.json)、[畫面](evidence/issue-18-browser/intermediate-cancelling-390.png)。畫面是窄版上半部，續跑按鈕在下方，非實機觸控驗收。

最後版以獨立合成 fixture 與 production Worker／靜態來源重跑：原場 `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`，同一取消 key `1dab7c0c-df9c-4c02-b3a2-6941374e6c1d` 的真 PUT 為 202（本文截斷）→ 200；重整後 390 CSS px、鍵盤 Enter 手動續跑，讀回 cancelled、winner 7、其他 1001 位各 5、非中獎者 4、公開 winners 空。新場 `f9769f27-c301-4646-b1fc-814f1951f110` 為空名單、觀眾重新報名序號 1；停用後無抽選取消不改分。[最後版收據](evidence/issue-18-browser/final-receipt.json)、[畫面](evidence/issue-18-browser/final-cancelling-390.png)。群資格重新查詢由本機 HTTP 測試驗證，這次瀏覽器新場無群限制。遲到抽選 callback 不覆蓋取消畫面由自動 UI 測試驗證，不冒稱本次瀏覽器已注入該競態。這是合成 Chromium，非真 Discord、遠端 D1 或實機；graceful restart 也不是 SQL 執行中斷電。
