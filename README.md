# Wuwa Draw

以鳴潮為主題的多主播直播觀眾抽選工具，與特定主播品牌無關。

- [現行規格、實作計畫與驗收清單](docs/development-plan.md)：唯一現行規格。
- [領域詞彙](CONTEXT.md)
- 已確認的取捨：[主播環境隔離](docs/adr/0001-streamer-isolation.md)、[取消的分數補償](docs/adr/0002-cancellation-compensation.md)。

目前有 issue #8 **隔離合成資料**原型、#9 資格管理、#10 本機開場、#11 本機觀眾入口與報名、#12 合成群資格、#13 本機暫停／退出、#14 本機快照抽選、#15 本機正常結算／續跑 UI，以及 #18 本機取消恢復 API 與 UI。#18 最新程式通過完整本機測試與最後版合成瀏覽器流程，正式部署、真 provider／遠端 D1／實機均未驗收。登入不授予主播資格；本機測試資料中的核准不決定正式管理政策。見 [issue #8 證據](docs/issue-8-evidence.md)、[issue #10 證據](docs/issue-10-evidence.md)、[issue #11 證據](docs/issue-11-evidence.md)、[issue #12 證據與真供應商限制](docs/issue-12-evidence.md)、[issue #13 證據與缺口](docs/issue-13-evidence.md)、[issue #14 證據與限制](docs/issue-14-evidence.md)、[issue #15 隔離驗收與限制](docs/issue-15-evidence.md)、[issue #18 證據與缺口](docs/issue-18-evidence.md)。

目前另有 #16 本機合成切片：報名時固定名稱快照，依本場群暱稱 → Discord 全域名稱 → 打碼 username →「中獎者」取用；打碼降低曝光但非匿名。公開 winner、本人單抽機率、主播本人名單及 Discord 聯絡入口；結算後本人仍可回查聯絡資料，剪貼簿合成拒絕時可手動選取複製。候選變更版本及最後已知更新時間持久化，舊資料時間可能未知；`as_of` 仍是讀取時間。公開結果目前只顯示未完成場次。真 Discord、遠端 D1、裝置及完整隱私保留仍未驗收，詳見 [issue #16 證據與缺口](docs/issue-16-evidence.md)。

目前另有 #19 本機到期歷史清理：僅設定的管理者可按指定主播範圍預檢、逐批執行，完成超過 90 天後才可清除詳細歷史，永久保留 UUID、主播 ID、終態及完成時間作防重播圍欄；共用身分與 session 仍可能含私人欄位。沒有自助刪除、排程、固定刪除完成期限或部署。舊資料若無可信完成時間會保留而非猜測。真實清理前須先停止舊 writer 並排空所有舊版在途請求，不能只依賴資料庫圍欄。[資料範圍、操作及本機證據](docs/issue-19-evidence.md)。

#20 整合驗收仍在進行：隔離合成 fixture 已驗取消恢復、報名去重、機率更新、OAuth 取消、53 人私有名單分頁、390 CSS px 登入連結鍵盤焦點，以及同瀏覽器不同 host cookie 的主播／觀眾部分流程；不限定群遮罩已在公開 API 與觀眾頁 DOM 驗證：顯示 `f***0` 且頁面不含合成原 username。結算續跑仍待原核准、獨立 browser context、實機、真 Discord／遠端 D1、完整素材與狀態驗收仍未完成。逐項結果及限制見 [#20 證據](docs/issue-20-evidence.md)。不得以先前切片結果代稱本次全部驗收通過。

## Issue #12 合成群資格（真供應商未驗收）

限制群場次可保存 Discord 邀請、要求額外授權並檢查成員；不保存存取權杖。本機合成瀏覽器及 74 項測試已驗證主要流程，但 Discord 的成員物件若缺少可選的 user ID，目前保守拒絕，可能誤拒真實成員；既有授權的 scope 縮減是否保留也未經真供應商驗證。須完成真實 provider 驗收後才可發布，不應視為整票完成。

## Issue #10 本機開場切片（整票未驗收）

本人可開場、鎖定選填群組與固定規則版本並重整接回；D1 原子建立有分觀眾基準，同一主播未完成場次占位，停用不刪除現場。本人版本化的下次群組預設與場次快照分開保存；開場時可確認或修改，改預設不改現場。API 使用 UUID 和服務端開場世代防止延遲首次提交；各分頁以 sessionStorage 保存未知操作，舊 localStorage 紀錄保留並要求核對，僅手動丟棄，不自動重送。合成測試涵蓋 SIGKILL、兩分頁延遲首次送出及實際預設修改；Promise.all 不證明兩請求同進 Worker 的交錯。後續取消恢復切片的進度見 #18，尚未驗證真 Discord、遠端 D1、真裝置或任何部署，不能用此版本實際舉辦活動。詳見[開場證據及限制](docs/issue-10-evidence.md)。

## Issue #9 本機已實作（真環境尚未驗收）

本分支新增保留原有資料的 `0003_streamer_status.sql`、以 `ADMIN_DISCORD_ID` 精確比對登入身分的管理 API、管理介面及停用時的寫入資格檢查。清單以 ID 字串順序 keyset 分頁；變動中的清單不是一致快照，重新讀取可重新開始。登入啟動量只讀取現有 UTC 日登入額度計數（每次管理頁讀取增加一次 D1 查詢），是實際通過站內額度的登入啟動數，不含被拒或 OAuth 尚未設定的請求，也不是 Cloudflare 帳戶用量、剩餘額度或完整服務請求量；不儲存個人明細。詳見 [issue #9 證據](docs/issue-9-evidence.md)。

所有本地資料庫須先套用新 migration；未設定或格式錯誤的管理者 ID 不賦予管理權。合成 Chromium 測試涵蓋首次核准前中斷及 404 後手動重試、丟失 PUT 回應的保守狀態顯示、第二頁操作和讀回失敗後重試；這些均非真 Discord 或實際裝置驗收。共用配額監控留待 #22；站內 UTC 登入啟動計數不是 Cloudflare 配額。真 Discord、實際裝置及後續 session 整合仍待驗證，不可部署或用真帳號驗收此未完成分支。

## 本機執行

需要 Node 22。以下只建立與使用本機 `.wrangler/` D1，不建立遠端資源：

```sh
npm ci
npx wrangler d1 migrations apply win-wuwa-local --local
npm run dev -- --port 19387
```

在同一台電腦開啟 `http://127.0.0.1:19387/`。未設定 OAuth 時登入回 503；這不是 fixture 登入。測試以 `npm run typecheck`、`npm test` 執行。登入 Discord 需既有、另行授權的 app，精確註冊 `http://127.0.0.1:19387/auth/callback`（實際 Discord 是否允許該註冊及完整流程尚未驗證）；自行透過安全本機方式設定 Wrangler 本地秘密 `DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET` 及 `ORIGIN=http://127.0.0.1:19387`，不要在聊天提供秘密。不要將 `.dev.vars` 提交。使用者必須已核准才可存讀；管理資格需要另行配置 `ADMIN_DISCORD_ID`。測試僅使用合成 ID。停止伺服器用 Ctrl-C。

此原型以本機 SQL 每 UTC 日限制最多 1000 次登入啟動、最多各 1000 筆 state/session，登入時分批清理過期紀錄；這是原型內部保護，不是已核准的產品限額。額度被耗盡會拒絕其他使用者，且這不是完整抗 DoS 或正式營運保護。不得對外公開或部署；遠端 D1、真實 Discord、帳戶額度與使用者裝置均未驗收。

## Issue #11 觀眾報名合成瀏覽器驗收

本機須套用所有 migrations（目前至 0018）。主播登入後可取得 `/s/<主播 Discord ID>` 固定入口；觀眾只看到公開場次與自己的報名。OAuth 返回仍須本人按確認；限制群資格的合成驗證見 #12，真供應商仍待驗收。隱私保留政策已顯示；#19 提供手動管理清理，尚未啟用自動清理，亦未完成法律審查。請勿部署或使用真帳號。

以獨立 loopback fixture 測試（不啟用原 19481 LAN preview）：

```sh
npm run build
WUWA_VIEWER_QA=1 WUWA_FIXTURE_PORT=19573 node test/browser-fixture.mjs
# 另一個 shell，等待 FIXTURE READY 後執行；每次須重啟 fixture 重置合成 D1
ego-browser nodejs < test/browser-viewer-qa.mjs
# 重新啟動 fixture 後另行執行故障測試
ego-browser nodejs < test/browser-viewer-failures.mjs
```

腳本以合成主播 123 和觀眾 300/301 測試序號 1/2、登出、重整隔離、拒絕後重試與登入途中換場；故障腳本另外截斷已寫入的回應、使本人讀取失敗並確認換場不默投。只會呼叫隔離的假 Discord，測試結束 Ctrl-C。fixture 的測試控制只在 loopback 且顯式 opt-in 可用，不在 Worker 生產程式。正式 Wrangler 靜態路由已另於本機實測，仍不等於遠端 Cloudflare、真 Discord、遠端 D1 或手機實測。

## 合成 OAuth 瀏覽器驗收

在本機以 `npm run build && node test/browser-fixture.mjs` 啟動，再以同機瀏覽器開啟 `http://localhost:19481/`。按「以 Discord 登入」、輸入測試文字並儲存、重新載入確認，再登出。停止用 Ctrl-C；每次啟動使用獨立暫存 D1，資料不保留。此 test-only 代理只綁定 loopback，把 production Worker 的 Discord 授權 302 改寫成本機合成授權，原 state 與 callback 保留；所有 Worker outbound 皆由 fixture 處理或拒絕，沒有真 Discord 連線。僅預先核准合成 ID `123`，不是正式資格政策。localhost 的 Secure cookie 行為依瀏覽器支援；別在其他站或用真憑證測試此 harness。這不驗證 Cloudflare 靜態資產路由、真 provider、部署或使用者裝置。

### 可信任區網合成測試（明確 opt-in）

HTTP **未加密、沒有區網存取認證**，同網段的人可連線並讀寫共用測試內容；只在可信任網路使用，勿輸入密碼、真帳號或敏感資料。以下 IP 是範例，須換成本機目前已指派的 RFC1918 IPv4；位址改變時須更新。以 Ctrl-C 停止。

```sh
npm run build
WUWA_LAN_PREVIEW=192.168.1.100 node test/browser-fixture.mjs
```

同網段裝置開 `http://192.168.1.100:19481/`，按「以測試帳號登入」。代理僅綁定指定介面，檢查 socket 對端所屬子網及精確 Host，不信任轉送標頭。所有裝置均使用合成帳號 `123` 和同一個隔離暫存 D1；資料跨裝置共用，停止即消失，不連真 Discord。區網模式僅在 test-only 代理把 `__Host-` cookies 換成 fixture 名稱並移除 Secure，以供 HTTP 運作，仍保留 Path、HttpOnly、SameSite；這**不是正式 HTTPS Secure cookie 驗收**。正式 Worker 不受此模式修改，不可將此 harness 公開、部署或用來處理真資料。
