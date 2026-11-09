# Issue #22：容量修補與交付界線

## 來源及方法

本副本 `src/` 與 `migrations/0001`–`0018` 在修補前逐目錄比對，與主 repo `77a7e8432611831d6f6a053d090a75e6946b6fce` 相同；副本並非獨立 git repo，不以其 git HEAD 識別來源。沒有部署、遠端資料庫、真帳戶或更改付費方案。原始 baseline 的 `evidence/issue22/{requests.jsonl,summary.json,run.log}` 原樣保留；測試建立的 after 在 profile scratch `issue22-after-final/{requests.jsonl,summary.json,run.log}`。同工具、相同 5×500×20、每主播 1,101 名歷史缺席、完整 49,050 候選快照；fixture／登入／開場成本不計。原始方法與限制見 `issue-22-capacity-evidence.md`。

## 實作

已納入 repository 的原始證據：[baseline 摘要](evidence/issue-22-capacity/baseline/summary.json)、[baseline 逐請求](evidence/issue-22-capacity/baseline/requests.jsonl)、[after 摘要](evidence/issue-22-capacity/after/summary.json)、[after 逐請求](evidence/issue-22-capacity/after/requests.jsonl)。原始基準與失敗日誌保留，不以修補後結果覆蓋。

- `0019_candidate_storage.sql` 以完整欄位複製到相同複合主鍵的 `WITHOUT ROWID` 表，消除舊表與複合主鍵 autoindex 的雙份記錄；未刪減快照或唯一、檢查和外鍵約束。歷史 migration 不變。這是全表一次性複製，非免費及無限歷史大小保證。
- `src/retention.ts` 候選頁面刪除改為複合主鍵，仍為每批最多 100 並保留 tombstone fence；舊的 rowid 選取不支援新表。其餘表及 tombstone 流程不變。這段新版程式同時相容舊表，切換遷移前必須確保所有可能運行的舊版 retention writer 停止。
- `src/settlement.ts` 使用 json 頁面 ID 為外迴圈、`CROSS JOIN` 迫使每個 ID 以 `(activity_id,viewer_id)` 既有主鍵索引搜尋報名。SQLite/D1 原計畫使用 ordinal 索引掃描場次報名後反覆掃 json；新查詢保留相同相等條件、owner、狀態、交易授權及 CAS，頁面 ID 來自 `UNION`，不重複。公式、取消開場基準、候選快照與冪等不變。
- `test/capacity-index.test.mjs` 真 Miniflare D1 的原 SQL query-plan 索引 RED→GREEN、49,050 筆既有合成快照逐列 migration 前後比較、新增一筆 rows_written=1、唯一及外鍵拒絕。原 retention 套件在遷移後先紅 9 個再修復，最終全綠；完整測試亦含結算、取消、重啟、權限與併發。這些測試不等於雲端遷移驗收。

## 實測每階段 D1 meta（本機，非雲端帳單）

| 階段 | baseline reads/writes | after reads/writes |
|---|---:|---:|
| 報名 | 26,990 / 10,000 | 26,990 / 10,000 |
| 抽選 | 348,650 / 98,900 | 348,650 / 49,850 |
| 結算 | 3,993,291 / 8,035 | 121,143 / 8,035 |
| 歷史 | 30 / 0 | 30 / 0 |
| 合計 | 4,368,961 / 116,935 | 496,813 / 67,885 |

少 49,050 writes（41.95%）、3,872,148 reads（88.63%）。after 原有 2,615 HTTP 請求、8,005 分數、2,500 報名、100 抽、49,050 快照與 5 journal；對每主播驗證缺席 1,101、未中 480、中獎 20 的分數。這個合成情境低於 [免費 D1 帳戶日額](https://developers.cloudflare.com/d1/platform/pricing/) 100,000 rows written、5,000,000 rows read，但未包含遷移、登入、開場、其他業務或共享帳戶流量，不構成日常流量保證；雲端計費、CPU 與 enforcement 尚未實測。`size_after` 7,774,208 → 5,185,536 bytes，只是兩次本機完整資料庫大小，非逐索引大小。

`npm run typecheck` 成功；`npm test` 成功 193/193，包含 `wrangler deploy --dry-run --outdir dist` 成功。紀錄在 scratch `issue22-after/full-test-final-large.log`，typecheck 成功見執行結果；兩個 RED 的結果、先前 9 個 retention 失敗及最終通過均實際觀察。測試輸出及構建只在副本。

## 平台限制與交付注意

父代理在 `wuwa-integrated22/source` 的整合來源副本再次執行 typecheck、完整測試（193 passed、0 failed、0 skipped，含 dry-run build）及容量工具，均 exit 0。再次取得 2,615 HTTP、496,813 reads／67,885 writes；8,005 分數與 49,050 快照維持不變。重驗日誌保留於 profile scratch `wuwa-integrated22/{typecheck,tests,capacity-bundle,capacity}.log`；未覆寫主 repo dist。

官方 [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) 寫免費每 Worker invocation 50 queries；[D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) 與[慢查詢指南](https://developers.cloudflare.com/d1/observability/find-expensive-queries/)說多條 SQL 是單一資料庫呼叫／round trip，失敗整批 rollback，但沒有明確說 50-query enforcement 對每個 batch 內 statement 如何計數。原情境結算最多 65 statements／HTTP，但不能由 statement 數斷言已超限，也不能斷言 batch 必算 1 query；沒有遠端驗證，因此未自行縮小頁面或宣稱 50-query 合規。

重要上線 gate：現有 `draw_candidates` 所有資料要一次複製，可能耗費大量遷移 writes、空間與執行時間，免費日額或 30 秒單查詢限制可能中斷；此 49,050 筆本機比較不代表任意現存歷史量可安全遷移。官方 [Wrangler migration 文件](https://developers.cloudflare.com/d1/wrangler-commands/#d1-migrations-apply)稱失敗會回滾該 migration；本次未驗遠端回滾、實際備援、migration 整批執行或真資料。不要直接套用：唯一下一步是在明確授權後盤點既有歷史量及非秘密用量，於隔離、具代表性的 D1 副本對 migration/回滾與舊版 writer 靜默做完整演練，再決定是否需可恢復的分批遷移。不可因此推論已核准遷移或部署。

未驗：遠端 quota／billing／CPU／50-query 計數；生產資料完整性、遷移耗時／rollback／備份與切換期間多版本 writer；真 Discord、瀏覽器及使用者操作。本批沒有部署或碰主 repo `dist`、19481。
