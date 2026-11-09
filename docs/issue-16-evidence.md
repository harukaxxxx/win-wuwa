# Issue #16：本機結果／機率／聯絡證據

此分支為隔離合成原型，不代表正式環境、真實 Discord 或整票已驗收。勿部署、使用真帳號或遷移遠端 D1。`0014` 新增最小身分表與抽選名稱，`0016` 新增報名名稱及來源快照、會員 proof 暱稱與 session 限時名稱資料。報名按本場群暱稱 → OAuth 全域名稱 → 打碼 username →「中獎者」選取並固定；不限群不增加 scope 或查群。打碼依 Unicode code point：至少 5 個留首尾各一，中間固定 `***`；1–4 個僅留首一及 `***`；空值為「中獎者」。打碼只減少曝光，並非匿名，仍可能被反推。公開 API 不送原始 username 或名稱來源；主播本人仍可讀完整聯絡 username／ID。後續登入不改舊報名或已保存 draw，舊無名顯示「中獎者」，不以現在身分資料回填。會員 proof 綁 session、場次、主播、群、規則及 5 分鐘效期；session 名稱有 8 小時效期。沒有保存 token、email。

## API 隱私及權限

| API | 對象 | 輸出／限制 |
| --- | --- | --- |
| `GET /api/viewer/:owner` | 公開 | 現有場次狀態、人數、規則、場次技術識別碼及可選群邀請；無報名名單／分數。 |
| `GET /api/viewer/:owner/results?cursor=N` | 公開 | 本未完成場次保存的 winner 顯示名稱，沒有 winner ID、username、聯絡資料、候選快照或分數；50 筆分頁。舊無名資料回退「中獎者」。 |
| `GET /api/viewer/:owner/chance?activity_id=...&rule_version=1` | 登入本人 | 本人狀態、序號、分數、目前單抽機率、`candidate_revision`、`candidate_updated_at` 與保留相容的 `as_of`。單一 SQLite SELECT 一致讀取版本、時間、本人及候選權重；只回傳本人值。`as_of` 為讀取時 Unix 秒，並非最後異動。`candidate_updated_at` 為最後已知異動的 UTC ISO 字串或 null；退出、中獎、未報名或場次不能抽時機率為 null。 |
| `GET /api/activities/history?cursor=N` | 登入本人 | 只查自己場次。 |
| `GET /api/activities/:id/roster?cursor=N` | 場次主播本人 | 該場完整名單，以序號 keyset 分頁 50 筆，含總人數、本人環境分數、Discord ID/username、顯示名稱及中獎時間；停用主播仍可讀本人歷史。管理者無跨主播權限。單次回應的場次、總數與該頁取自同一 SQLite SELECT 快照（含空頁）；不同請求之間並非固定快照，資料變動時應重讀核對。 |

固定入口僅顯示當前未完成場次的公開結果；結算後固定入口顯示無場次，目前尚未提供公開歷史結果。原規格 [development-plan.md §4、AC-15](development-plan.md) 要求公開安全摘要及固定入口無場提示，並未明定已完成場次的公開查閱入口；§5 要求詳細歷史保留 90 天，但不等於公開歷史功能已實作。主播可透過本人歷史讀取結束場次。聯絡連結只在 UI 由數字 ID 建構 `https://discord.com/users/<ID>`，開啟由主播自行操作；提供可選取的 username/ID 及複製按鈕，不代發或保證可聯絡、送達。

## 候選異動語意

`0015` 在場次儲存版本及時間：SQLite trigger 與寫入同交易處理 open/paused 場次的 registered 候選加入、退出、抽中、序號或身分變動，及該主播該候選有效分數變動；無實際分數改動、非候選、其他主播與純 GET 不變。進入 settling 即使沒有候選也遞增版本；settling 後分數結算不再改候選版本。每列異動可遞增一次，版本不是抽選次數。UTC 時間由 SQLite 記錄至毫秒，但同毫秒可相同、系統時鐘亦可能調整；以同場版本而非時間比較先後。沒有已知異動時為 null：既有場次與新空場均以版本 0／未知開始，保留原 `created_at` 但不將建立時間冒充舊名單最後異動時間；歷史最後異動不可回推。遷移保留原始資料，後續真實異動才寫時間。

## 本次驗證

- 名單分頁與報名恢復修正：名單同頁請求防重入，換場或重選同場時丟棄舊回應；報名結果未知時機率顯示未知，重新確認後刷新本場機率與版本。`test/results-ui-races.test.mjs` 使用 production JS 及合成 DOM 驗證延遲回應；Ego Chromium 390px 在本機 fixture 另驗同頁雙點、同場重選、跨場舊回應與丟失報名回應後重新確認，非實體裝置或真 provider。重現：隔離副本 build 後以 `WUWA_FIXTURE_PORT=19843 WUWA_VIEWER_QA=1 WUWA_MANAGEMENT_QA=1 WUWA_STATUS_QA=1 WUWA_DRAW_QA=1 WUWA_SETTLEMENT_QA=1 node test/browser-fixture.mjs` 啟動，再執行 `ego-browser nodejs < test/browser-results-races-qa.mjs`；名單延遲資料由瀏覽器合成，報名使用本機 Worker/D1。最後完整測試 152/152；typecheck、dry-run build、兩項 npm audit 通過。

- 最新名稱切片：隔離完整來源副本 `cache/scratch/wuwa16-name`、獨立 TMPDIR 與本機 Wrangler 輸出執行 `npm run typecheck`、`npm test`（含 dry-run build）：**150/150 pass、0 fail**；`npm audit` 及 `npm audit --omit=dev` 均 0 vulnerabilities。新增 workerd/D1 OAuth／Worker 請求測試（Miniflare `dispatchFetch`）先觀察舊實作 RED，再通過；涵蓋跨主播群暱稱、無群只 identify、pending 拒絕、偽造名稱拒絕、冪等、改名後快照、短字／Unicode／字面 `*` 打碼及無名舊資料；0016 migration 保留分數、proof、draw、settlement。測試記錄在副本 `tests-final.log` 等檔案。
- 最後版 Ego Chromium：兩個全合成 OAuth、本機 workerd/D1 及 production public assets fixture，在 CSS viewport `innerWidth=clientWidth=scrollWidth=390` 實走報名、候選更新時間、主播抽選、私人 ID／username 聯絡、登出及公開 winner；分別讀回「群暱稱 300」和打碼 `f***0`，原始公開 JSON 只有顯示名稱且沒有 `fixture_300`。見 [收據](evidence/issue-16-browser/name-snapshot-receipt.json)、[群暱稱](evidence/issue-16-browser/name-nickname-public-390.png)、[打碼](evidence/issue-16-browser/name-masked-public-390.png)、[私人聯絡](evidence/issue-16-browser/name-owner-private-390.png)。非真 Discord、正式資產部署路由或實體手機。重現需在隔離來源 build 後，分別以 `WUWA_FIXTURE_PORT=19831 WUWA_NAME_QA=nick` 和 `WUWA_FIXTURE_PORT=19832 WUWA_NAME_QA=masked` 加上 `WUWA_VIEWER_QA=1 WUWA_MANAGEMENT_QA=1 WUWA_STATUS_QA=1 WUWA_DRAW_QA=1 WUWA_GUILD_QA=1` 啟動 `node test/browser-fixture.mjs`，再執行 `ego-browser nodejs < test/browser-name-snapshot-qa.mjs`（調整輸出絕對路徑）。


- 追加修正後以隔離副本及獨立 TMPDIR 執行 `npm run typecheck` 與 `npm test`：**145/145 通過**；兩種 `npm audit` 皆 0 vulnerabilities。Wrangler 對隔離 local D1 實際套用 0001–0015 成功；未操作遠端。真 loopback HTTP 的並行分數修改與讀取驗證版本對應權重，並行新增報名驗證每次 roster 回應頁數與總數一致；這是併發測試，非所有可能提交交錯的窮舉。另覆蓋 GET 不改版本、其他主播隔離、報名／退出／抽中／空候選結算、舊資料保留和未知時間。測試記錄：`cache/scratch/issue16-revision/full-test.log`（profile 下，暫存會清理）。

- 寫入實作前，新真 Worker/D1 的本人機率測試因路由不存在得到預期 404（RED），加入後通過（GREEN）。
- 先前版本使用 profile scratch 隔離原始碼與 dependencies 副本、獨立 `TMPDIR` 和 Wrangler metadata，當時 `npm run typecheck`、`npm test` 通過；完整測試 **141/141 通過**（含既有及新增測試）。測試走 workerd/Miniflare 和完整本機 D1 migrations：原始公開 JSON 欄位遞迴及合成私有字串、本人公式／暫停／修改、非本人與 admin 拒絕、停用本人、107 人跨三頁、持久結果及登入身分更名後不變、舊資料 migration 保留分數、proof、draw snapshot 和 settlement。`results-contact.test.mjs` 走真 loopback HTTP，補驗實際正常結算後 owner 歷史及 roster 仍回 winner 聯絡資料，匿名 401、其他觀眾與 admin 404，公開固定入口無場且結果空白。
- OAuth 測試以合成 provider payload 驗證只保存指定的 ID、global_name、username；沒有做真 Discord 整合。
- Ego Chromium、隔離 loopback fixture 19797：訪客 → 合成登入 → 報名 → 更新本人 100% 單抽 → 登出 → 主播登入抽選 → 本人歷史及名單 → username 鍵盤複製 → 登出 → 公開 winner → 無場固定入口。成功分支為先前證據。
- 另以隔離 fixture 19798 驗證合成報名、抽選、實際正常結算、重新載入後從本人歷史開啟已結束場次並鍵盤 Enter 分別按 username／Discord ID 複製；fixture 明確 opt-in 讓 `writeText` 以 `NotAllowedError` 拒絕，兩者均焦點到只讀輸入框並選取完整值，提示手動複製且未聲稱已複製。登出後固定入口無場，公開 API 空結果且不含聯絡資訊。這是瀏覽器中**合成 API 拒絕**，不是作業系統／真實瀏覽器權限提示測試。[收據](evidence/issue-16-browser/denied-receipt.json)、[390px 畫面](evidence/issue-16-browser/denied-390.png)；`innerWidth=clientWidth=scrollWidth=390`。未測真手機、真 Discord DM 或送達。重跑：隔離副本 build 後設定 `WUWA_FIXTURE_PORT=19798 WUWA_VIEWER_QA=1 WUWA_MANAGEMENT_QA=1 WUWA_STATUS_QA=1 WUWA_DRAW_QA=1 WUWA_SETTLEMENT_QA=1 WUWA_DENY_CLIPBOARD_QA=1` 啟動 `node test/browser-fixture.mjs`；執行 `ego-browser nodejs < test/browser-results-denied-qa.mjs`（調整其收據與截圖的 scratch 絕對路徑）。拒絕注入僅 test fixture 且 loopback opt-in，不在 production Worker。
- `npm audit` 與 `npm audit --omit=dev`：均 0 vulnerabilities；純屬目前鎖檔的本機稽核。

## 尚待

- 新政策本機實作與合成驗證見上；真 Discord nullable `global_name`／群成員資料的提供者行為尚未驗證，不等同正式上線或整票驗收。舊版瀏覽器收據不證明新版名稱政策。
- 公開結果僅當前未完成場次，結算後無公開歷史；是否需要歷史展示待產品確認。取消恢復尚未實作，不能驗收取消歷史無效展示。
- 真 Discord OAuth／聯絡、遠端 D1、正式 Worker 靜態路由與裝置均未測；未部署。隱私清理和法律審查仍未完成。
