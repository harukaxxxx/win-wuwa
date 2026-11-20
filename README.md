# win-wuwa

Who Is Next 的鳴潮布景宿主，不維護另一套報名、抽選、結算或前端操作流程。

## 分工

- `../who-is-next/`：可獨立啟動的完整應用，擁有預設介面、共用操作、後端、schema、測試與產品文件。
- `theme/theme.json`：品牌文字。
- `theme/theme.css`：配色與字型等外觀覆寫；目前只有原創幾何布景，沒有官方角色素材或動畫。
- `scripts/build-theme.mjs`：呼叫共用資產建置 module，從 Who Is Next 產生 `.generated/public/`。`app.js` 與 `viewer.js` 逐位元組沿用，不能另改一份。
- `src/index.ts`：載入共用 Worker。`wrangler.jsonc` 保留此宿主部署設定；`migrations` 連至應用的唯一 schema。

## 本機使用

Node 22.23.1；兩專案同層。先取得固定版本核心，再分別於核心及本目錄執行 `npm ci`。於此目錄執行 `npm run dev -- --port 19388`。本機 D1 需先以 `npx wrangler d1 migrations apply win-wuwa-local --local` 套用（本次不自動修改既有資料庫）。OAuth 配置不因程式搬移自動複製；不要在聊天提供秘密。

乾淨環境的取得方式（在尚無這兩個資料夾的父目錄）：

```sh
git clone https://github.com/harukaxxxx/win-wuwa.git
git clone https://github.com/harukaxxxx/who-is-next.git
git -C who-is-next checkout --detach "$(node -p "require('./win-wuwa/core-ref.json').commit")"
npm --prefix who-is-next ci
npm --prefix win-wuwa ci
```

`core-ref.json` 固定核心 repository 與完整 commit SHA；CI 驗證格式並取出該版本，執行兩側完整檢查，不追蹤核心的浮動分支。本機共同開發可用各自 `dev`；更新宿主 pin 前，核心版本必須先測試並推送。不要為了切換核心版本覆蓋已有未提交變更。

`npm run typecheck`、`npm test` 驗證宿主接線與主題建置。完整產品測試在 `../who-is-next` 執行 `npm test`。build 只有 Wrangler dry-run，不是部署。

## 規格與限制

- [產品規格](../who-is-next/docs/development-plan.md)、[領域詞彙](../who-is-next/CONTEXT.md)、[拆分證據](../who-is-next/docs/core-split-evidence.md)。
- Who Is Next 不裝此主題仍能操作；本機合成登入預覽入口與操作說明見其 README。
- 多遊戲分數與混合場次、角色動畫及主播自訂圖片尚未實作。
- 布景不決定資料歸屬；切換布景不等於跨遊戲混抽。兩個本機配置使用不同 D1 名稱與狀態目錄，不會自動共享資料；正式多主題資料拓撲尚未決定。
- 核心保留舊 repository 歷史，現在位於 `harukaxxxx/who-is-next`；此 `harukaxxxx/win-wuwa` 是新宿主 repository，不沿用舊 issue 編號。通用功能／規格的 issues 在核心，純鳴潮布景問題在此。
- `main` 為宿主初始基線，`dev` 用於日常開發。CI 只有安裝、型別／測試、audit 及 build dry-run，沒有部署步驟或 Cloudflare 憑證；沒有發布 npm 套件或建立付費資源。Cloudflare 配置與部署仍需另行授權。
