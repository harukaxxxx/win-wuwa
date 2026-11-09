# Issue #21：本機跨流程安全驗證證據

## 狀態與範圍

本機工程驗證完成；**不是整張 issue、遠端 D1、瀏覽器或真實 Discord 的驗收通過宣告**。#21 原文的「目前 repository 僅有文件」是發布時歷史邊界，不能用來描述本次實測快照。讀取 `harukaxxxx/win-wuwa#21`：OPEN、無 comments。AC 編號依 `docs/development-plan.md` §7；表格只主張本機列出的子項，不代表整條 AC 均完成。

來源為 `d25737d7bfa94ba14fa7aa2782eabe71a14cc60b` 加上複製當下的未提交 #20 工作，並非乾淨 commit。獨立來源及依賴位於 `/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch/issue21-delivery`；排除 `.env*`、`.dev.vars*`、`.git`、`.wrangler` 和主專案 dist。測試含真實 production Worker 邏輯和本機 Miniflare D1；某些 commit-boundary 測試用測試 wrapper 包裝 `src/index.ts` 注入交錯，並非完全未包裝 runtime；某些狀態由直接 SQL fixture 建立。Discord outbound 為合成回應，不是真 provider。

**範圍事件：**第一次補複製依賴後，因錯誤 working directory 在主 repo 執行了一次 `npm test`，其 dry-run build 寫入被 Git 忽略的主 repo `dist/`（`dist/index.js` 顯示 2026-11-10 00:07:01 +0800）。這違反了不得觸碰主 repo dist 的要求；無法確認原 dist 內容或安全恢復，因此未擅自覆寫回去。主 repo 該次測試輸出摘要 191 pass / 0 fail / 0 skipped；該次完整 log 隨後被 scratch 正確重跑結果覆蓋，不作為本稿主要證據。未操作 preview 19481。主 repo 追蹤檔狀態未因本次測試顯示新增變更，但不能據此推定 ignored 資料未受影響。

## 實跑

在上述 scratch 路徑執行；Node v22.23.1、npm 10.9.8；套件版本與 lockfile 見 package.json。`TMPDIR` 指向 profile scratch。完整輸出為本交付目錄的 `issue21-npm-test.log`、`issue21-typecheck.log`。

```text
$ npm run typecheck
> typecheck
> tsc --noEmit
# exit 0

$ npm test
> test
> npm run build && node --test test/*.test.mjs
...
1..155
# tests 191
# suites 0
# pass 191
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 33221.685583
# exit 0
```

`npm test` 的 build 是 Wrangler dry-run，只寫 scratch 的 dist，不部署。155 為頂層測試、191 包含巢狀測試；不是 191 個彼此獨立測試檔。初次 scratch 嘗試因複製規則誤排除 `node_modules/miniflare/dist` 而 `MODULE_NOT_FOUND`、exit 1；補齊 scratch 依賴後才有上列完整成功結果。

## 原 AC 與具體可追溯證據

| 原 AC | 本機子項及測試位置 | 界線 |
|---|---|---|
| AC-01 | `draw.test.mjs`「same and different keys concurrently...」確認另一主播同觀眾分數不變；`session-opening.test.mjs`「owners isolated...」及 `results-contact.test.mjs`「private roster...」檢查權限 | 未宣稱所有跨主播全生命週期的真環境驗收 |
| AC-03 | `viewer-registration.test.mjs`「actual HTTP concurrent disable and register...」；`session-opening.test.mjs`「simultaneous HTTP disable and open...」和「disable immediately before opening batch...」；`draw-interleave.test.mjs`「disable after read prevents commit」；`management.test.mjs` 停用及重新核准 | 合成身分；HTTP 競態一次執行不保證觀察到兩種排程 |
| AC-04 | `session-opening.test.mjs`「same owner concurrent...」、「different approved owners can open concurrently」；`settlement.test.mjs`「partial page failure...」及 `cancellation.test.mjs`「failed restoration...」保留占位 | 本機 D1 約束和狀態轉移，不代表遠端負載 |
| AC-05 | `pause-withdraw.test.mjs`「HTTP pause and registration serialize; withdrawal races pause」、「pause keeps existing retry...」及「concurrent resume CAS...」；`draw.test.mjs`「paused draw, withdrawal first...」 | pause/draw 部分有直接 SQL 設定暫停的 fixture |
| AC-07 | `session-opening.test.mjs`「locked rule and guild...」、「stale first submission...」；`viewer-oauth.test.mjs`「return retains stale original context...」；`cancellation.test.mjs`「new winner remains zero... fresh roster」 | 合成 OAuth；不得據此聲稱真 Discord 舊頁返回已驗收 |
| AC-09 | `pause-withdraw.test.mjs`「pause keeps existing retry...」測永久退出及保分；`draw.test.mjs`「persisted draw... winner cannot withdraw」和「paused draw, withdrawal first...」；`draw-interleave.test.mjs`「withdrawal after read wins...」 | 強制抽選邊界交錯使用 SQL 注入；不代表所有可能交錯 |
| AC-10 | `draw.test.mjs` 同鍵及異鍵並行；`draw-interleave.test.mjs` registration/withdrawal/score/disable 讀後變更及 batch 失敗回滾；`draw-kill.test.mjs` Worker commit 後回應前 SIGKILL，同鍵重試；`draw-restart.test.mjs` | 本機 deterministic 邊界注入與合成失敗；真實網路或 provider 未測 |
| AC-13 | `cancellation.test.mjs`「cancel restores only this activity winners...」、「failed restoration...」、「finish and cancellation competing...」；`cancellation-interleave.test.mjs` 兩種終點先後、抽選、報名、退出與撤銷/逾期；`cancellation-restart.test.mjs` | 注入 wrapper 的巢狀操作測指定 SQL 邊界，非遠端中斷證明 |
| AC-17 | `history-retention.test.mjs`「retention boundary...」、「a real cancelled activity...」、「overlapping cleanup...」、「delayed legacy OAuth...」；`history-retention-restart.test.mjs` 恢復清理 | 合成時間與 fixture；隱私法律、真環境定時清理未驗收 |
| AC-18 | `prototype.test.mjs`「real D1 unique constraints and failed atomic batch rollback」、「owner-only environment, csrf and concurrent CAS」、「OAuth state, PKCE, secure cookies, replay and no secret exposure」、「provider failures do not expose synthetic secrets in runtime logs or HTTP」；上列 draw/settlement/cancellation/cleanup 邊界、重啟及 SIGKILL 測試 | 本機 D1 emulator 的結果不能證明 Cloudflare 遠端 D1 原子性或真實服務行為；只檢查所設計情境中的合成秘密，不證明全系統絕無洩漏 |

補充正常結束的提交順序：`settlement-interleave.test.mjs` 明列 `before-register`、`after-register`、`before-withdraw`、`after-withdraw`、`before-draw`、`nested-settle`、`draw-before-end`，驗證狀態與分數；另外測 session 在 fence/page/finish 撤銷或到期及 batch 內到期回滾。`settlement-restart.test.mjs` 驗證 graceful restart 恢復 cursor。`cancellation-interleave.test.mjs` 指定結算和取消兩種先後、報名與退出前後、抽選前後，並檢查終點與結果。這些是指定交錯，不是所有交錯的窮舉或形式證明。

安全與 scope：`prototype.test.mjs` 驗證 state 綁定 cookie、過期／重放拒絕、S256 challenge/verifier、精確 redirect、`Secure; HttpOnly; SameSite=Lax`、Origin 與 CSRF、模擬 provider 錯誤的 HTTP 和 runtime log secret 檢查；`viewer-oauth.test.mjs` 覆蓋不同並行 state 的 cookie 混用與拒絕授權返回；`guild-membership.test.mjs` 檢查僅需 identify 的活動及需要 `guilds.members.read` 的活動，並測 scope 缺失 fail closed。[Discord 官方 OAuth 文件](https://docs.discord.com/developers/topics/oauth2)列 identify、guilds.members.read 與 state；[Discord 官方 metadata](https://discord.com/.well-known/oauth-authorization-server) 本次讀取列出 `code_challenge_methods_supported: ["S256"]`。官方宣告支持不等於本 app 的真 provider 交換已實測。

## 補測取捨與未驗證

限定的高風險提交先後、故障回滾、隔離、安全案例已有具體測試且本次全套跑過，因此不增設重複測試或重建 harness；新增測試數 **0**。這不表示已窮舉所有交錯，也不表示 AC 每個字面條件已通過。

仍需另行授權及規劃：隔離的遠端 Cloudflare D1 原子 batch/CAS/約束、故障及恢復；真 Discord app 的 redirect、授權拒絕、scope、PKCE、成員資格與 provider 錯誤；實際 HTTPS 瀏覽器 cookie、CSRF、重啟／可及性及 UI 驗收。#20 settlement browser 操作先前有待核准請求，本次未執行、未重送或等價改道，亦未修改 `browser-settlement-qa.mjs`；本機 node tests 不取代它。容量另由 #22 處理；法律和部署配置非本次證據。若遠端 D1 測試發現不變量不成立，必須停止並重新設計，不得以此本機結果覆蓋失敗。未部署、建立遠端 D1、使用真 Discord 或更新 tracker。
