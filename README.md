# Wuwa Draw

以鳴潮為主題的多主播直播觀眾抽選工具，與特定主播品牌無關。

- [現行規格、實作計畫與驗收清單](docs/development-plan.md)：唯一現行規格。
- [領域詞彙](CONTEXT.md)
- 已確認的取捨：[主播環境隔離](docs/adr/0001-streamer-isolation.md)、[取消的分數補償](docs/adr/0002-cancellation-compensation.md)。

目前有 issue #8 **隔離合成資料**的窄路徑原型，另可選擇僅供可信任區網的測試入口；其餘功能及正式部署尚未完成。實測範圍、官方資料、限制及未完成關卡見 [issue #8 證據](docs/issue-8-evidence.md)。登入不授予主播資格；本機測試資料中的核准不決定正式管理政策。

## 本機執行

需要 Node 22。以下只建立與使用本機 `.wrangler/` D1，不建立遠端資源：

```sh
npm ci
npx wrangler d1 migrations apply win-wuwa-local --local
npm run dev -- --port 19387
```

在同一台電腦開啟 `http://127.0.0.1:19387/`。未設定 OAuth 時登入回 503；這不是 fixture 登入。測試以 `npm run typecheck`、`npm test` 執行。登入 Discord 需既有、另行授權的 app，精確註冊 `http://127.0.0.1:19387/auth/callback`（實際 Discord 是否允許該註冊及完整流程尚未驗證）；自行透過安全本機方式設定 Wrangler 本地秘密 `DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET` 及 `ORIGIN=http://127.0.0.1:19387`，不要在聊天提供秘密。不要將 `.dev.vars` 提交。使用者必須已有隔離測試用 `approved_streamers` 行才可存讀，原型不提供核准 UI 或正式開通政策。預設沒有核准行；自動測試僅插入合成 ID。停止伺服器用 Ctrl-C。

此原型以本機 SQL 每 UTC 日限制最多 1000 次登入啟動、最多各 1000 筆 state/session，登入時分批清理過期紀錄；這是原型內部保護，不是已核准的產品限額。額度被耗盡會拒絕其他使用者，且這不是完整抗 DoS 或正式營運保護。不得對外公開或部署；遠端 D1、真實 Discord、帳戶額度與使用者裝置均未驗收。

## 合成 OAuth 瀏覽器驗收

在本機以 `npm run build && node test/browser-fixture.mjs` 啟動，再以同機瀏覽器開啟 `http://localhost:19481/`。按「以 Discord 登入」、輸入測試文字並儲存、重新載入確認，再登出。停止用 Ctrl-C；每次啟動使用獨立暫存 D1，資料不保留。此 test-only 代理只綁定 loopback，把 production Worker 的 Discord 授權 302 改寫成本機合成授權，原 state 與 callback 保留；所有 Worker outbound 皆由 fixture 處理或拒絕，沒有真 Discord 連線。僅預先核准合成 ID `123`，不是正式資格政策。localhost 的 Secure cookie 行為依瀏覽器支援；別在其他站或用真憑證測試此 harness。這不驗證 Cloudflare 靜態資產路由、真 provider、部署或使用者裝置。

### 可信任區網合成測試（明確 opt-in）

HTTP **未加密、沒有區網存取認證**，同網段的人可連線並讀寫共用測試內容；只在可信任網路使用，勿輸入密碼、真帳號或敏感資料。以下 IP 是範例，須換成本機目前已指派的 RFC1918 IPv4；位址改變時須更新。以 Ctrl-C 停止。

```sh
npm run build
WUWA_LAN_PREVIEW=192.168.1.100 node test/browser-fixture.mjs
```

同網段裝置開 `http://192.168.1.100:19481/`，按「以測試帳號登入」。代理僅綁定指定介面，檢查 socket 對端所屬子網及精確 Host，不信任轉送標頭。所有裝置均使用合成帳號 `123` 和同一個隔離暫存 D1；資料跨裝置共用，停止即消失，不連真 Discord。區網模式僅在 test-only 代理把 `__Host-` cookies 換成 fixture 名稱並移除 Secure，以供 HTTP 運作，仍保留 Path、HttpOnly、SameSite；這**不是正式 HTTPS Secure cookie 驗收**。正式 Worker 不受此模式修改，不可將此 harness 公開、部署或用來處理真資料。
