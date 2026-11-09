# Issue #22：隔離本機容量實測

## 結果及範圍

2026-11-10（UTC+8）；基於 `issue-20-ui-integration` HEAD `d25737d7bfa94ba14fa7aa2782eabe71a14cc60b` **及其當時未提交工作樹**的獨立副本。不是乾淨 HEAD；特別是 `src/index.ts` 含既存 #20 變更。將本工具套回後需以整合時的實際來源重新執行。沒有修改主 repo、部署、存取遠端 D1 或真帳戶，也沒有啟用付費。

- 5 位合成主播共用同一個隔離 Miniflare D1；每位 500 位合成觀眾透過實際 Worker HTTP 報名，共 2,500 個 200。
- 每位另有 1,101 位不報名的歷史觀眾，初始分數皆為 5；500 位報名者也以 SQL 預置分數 5。帳號 session、場次、歷史分數以合成 SQL fixture 建立，沒有量測登入、開場或 fixture 寫入的成本。不存在真 Discord 呼叫。
- 5 主播每輪並行各抽 1 次，共 20 輪 100 抽；每抽斷言持久候選快照數量依序 500 到 481，且每位有 20 個互異 winner。總候選快照 49,050 行，全部保留於本機 D1；資料列與索引清單存於 summary。
- 5 主播並行結算，每主播先回 202 再回 200。每主播精確驗證 1,101 歷史缺席由 5 降至 4、480 未中者 5 升至 6、20 winner 為 0，且分數 1,601 筆都保留，狀態 settled。這是此測試下的缺席全量與不截斷驗證，不是所有 AC-11 情境的驗收。
- 5 主播以已驗證的合成 session 呼叫歷史 HTTP API，各讀回自己的已結算場次。

## 實際本機 D1 meta

每個 HTTP 請求的 `rows_read`、`rows_written`、SQL statement 數、狀態及端到端 wall time 都在 `requests.jsonl`；所有已完成 statement 均回傳兩種 meta（`missing=0`）。先按每 statement meta 加總，不把索引寫入再額外加一次；官方說明索引列計入寫入。完整結構及索引名稱見 `summary.json`，完整命令輸出見 `run.log`。

| 階段 | HTTP 次數 | rows_read | rows_written | SQL statements |
|---|---:|---:|---:|---:|
| 報名 | 2,500 | 26,990 | 10,000 | 5,000 |
| 抽選 | 100 | 348,650 | 98,900 | 1,000 |
| 結算 | 10 | 3,993,291 | 8,035 | 585 |
| 歷史 | 5 | 30 | 0 | 10 |
| 合計 | 2,615 | 4,368,961 | 116,935 | 6,595 |

例如一次首抽 3,535 read / 1,008 written；一次第 20 抽 3,435 read / 970 written。實際每次輸出均獨立保存，不是預測。結算 202 請求各約 49.8–50.2 萬 reads，後續 200 各約 29.9 萬 reads。`elapsed_ms` 含排隊與測試包裝成本，不是 CPU；各請求 wall time 相加不是總執行時間。

最終 8,005 筆分數、2,500 報名、100 抽、49,050 快照、5 結算 journal；D1 `meta.size_after` 7,774,208 bytes（含表與索引）。本機 `dbstat` 不可用，無法拆表與索引的儲存空間；索引種類、定義及 SQLite autoindexes 留在 summary，不能將總空間當作索引專屬消耗。首次嘗試的容量情境與斷言完成，但查 `PRAGMA page_count` 因 D1 `SQLITE_AUTH` 失敗，整次工具 exit 1；原始紀錄 `run-first-failed.log` 與 `requests-first.jsonl` 保留。改以 `size_after` 完整執行 exit 0；加入歷史 API 後再執行，以上是最終完整結果。

## 官方免費限制及本機／遠端區別

2026-11-10 查核：官方 [D1 計價](https://developers.cloudflare.com/d1/platform/pricing/) 免費方案帳戶共用每日 5,000,000 rows read、100,000 rows written、共 5 GB；每天 00:00 UTC 重置；索引寫入亦計入，超限後 D1 查詢失敗；[D1 限制](https://developers.cloudflare.com/d1/platform/limits/) 包括單資料庫 500 MB、10 資料庫和每 Worker invocation 50 D1 queries；[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/) 為每日 100,000 requests、每 invocation 10ms CPU（偶發超額有彈性）。[Cloudflare 2026-09-01 公告](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)確認免費每日列數上限已強制。

本機數字只對照官方額度，**不是遠端帳戶用量或剩餘額度**：此場景單次本機 116,935 written 已高於官方 100,000/日；4,368,961 read 也接近 5,000,000/日，而且未計其他服務和上述 fixture/開場/登入成本。雲端 D1 的計量與本機 meta 可能不同；本機沒有強制每日 quota、Workers CPU、延遲與實際部署行為。`statements` 是每個 batch 的各 SQL statement 數，不等同已驗證的雲端 subrequest/query 計數；部分結算 HTTP 65 statements，是否受 50 query 限制及實際批次計數尚未由遠端驗證，不能宣稱免費環境可用或承諾容量。共享帳戶其他用量、剩餘額度、實際 quota enforcement、雲端 CPU／延遲、Discord 與瀏覽器均未驗證。

## 可重跑

在隔離副本根目錄，已安裝與 lockfile 對應 dependencies（需要現有 `esbuild`、Miniflare、workerd）：

```sh
set -o pipefail
export TMPDIR=/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch
mkdir -p dist evidence/issue22
./node_modules/.bin/esbuild test/capacity-worker.mjs --bundle --format=esm --platform=browser --target=es2022 --outfile=dist/capacity-worker.js
node test/capacity.mjs 2>&1 | tee evidence/issue22/run.log
```

使用 bash/zsh 時以 `set -o pipefail` 或 `exit ${PIPESTATUS[0]}` 正確取得 node exit；本次 bash 使用後者。工具會覆寫 requests.jsonl、summary.json 與 run.log；需要保留前次結果請先另存。固定 loopback 19689；請先確認未被占用。`capacity-worker.mjs` 只供本機測試，將真正的 Worker 包起來計量 D1：對 `first()` 以相同 SQL 的 `all()` 取得 meta 再取首列；對 batch 逐筆匯總。這改變了測試包裝的 D1 API 呼叫實作，不能將 timing 當原版效能；未測失敗時 statement meta（已回應只有成功 meta），不能推論雲端帳單。所有輸出僅合成資料；切勿部署包裝器。

另在獨立副本執行 `npm run typecheck && npm run build && node --test test/draw.test.mjs test/settlement.test.mjs`：typecheck、dry-run build 通過，9 tests 全過；完整輸出 `evidence/issue22/regression.log`。非全套測試。

整合檔案：`test/capacity-worker.mjs`、`test/capacity.mjs`、`docs/issue-22-capacity-evidence.md`，以及要保存的 `evidence/issue22/{run.log,requests.jsonl,summary.json,run-first-failed.log,requests-first.jsonl,regression.log}`。不要帶入 `dist` 或 `node_modules`。原始 issue 說明中的「僅有文件」已過時，本報告只依本機實際程式及結果陳述。
