# Issue #10 本機開場切片：實作與證據

僅隔離合成身份、workerd、D1 和 Chromium；沒有真 Discord、遠端 D1、部署或手機驗收。父工作階段仍須獨立審查。

## 實作與安全邊界

- `PUT /api/activities/{uuid-v4}` 僅接受固定 `rule_version:1`、`expected_generation`、`guild_id:null` 或 1–32 位數字；身分由登入決定。同 ID 同內容重試回既有場次；不同內容衝突。`GET /api/activities/current` 一次 SQL 讀取本人未完成場與開場世代，停用後仍可讀回。管理者不能代理其他主播。
- `0004` 的 partial unique index 保證各主播最多一個 initializing/open/paused/settling/cancelling 場；D1 batch 原子建立占位、完整複製所有非零觀眾分數為基準並轉為 open。未存基準表示開場分數零。`0005` 保留歷史 ID，按既有場次數初始化世代；插入時驗證及遞增世代與基準同批提交。未來終點不得刪 ID 或倒退世代。
- `0006` 建立獨立每主播群組預設：`GET/PUT /api/activity-default`，DTO 僅 `guild_id`、CAS `version`；停用寫入在 SQL 條件拒絕，管理者沒有其他人操作入口。UI 可儲存下次預設，開場前顯示並允許選擇，本場始終快照固定版本 1 和所選群組。改預設不修改 open/paused 場；群組成員檢查尚未實作。
- 分頁以 `sessionStorage` 的 `wuwa-open-{owner}` 保存 ID、群組和世代供同分頁重整或重新登入恢復；關頁後不保證。升級時檢查同鍵 `localStorage` 的舊資料，保留原文顯示及阻擋新操作，先讀取 current 核對；缺世代的舊操作不自動送出或改寫世代，僅使用者主動按丟棄移除。409 後不得自動新建，須重新讀取及確認。

## 本次驗證

在隔離快照 `/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch/wuwa-issue10-final-20261109`，固定 `TMPDIR=/Users/haruka/.hermes/profiles/makino-futsuki/cache/scratch`，執行 `npm run typecheck && npm test && npm audit && npm audit --omit=dev`：typecheck、dry-run build 通過；40 tests、40 pass、0 fail；兩次 audit 均 0 vulnerabilities。新預設 API 測試先對舊 Worker 觀察 `not found` 的 RED，再實作並通過；測試涵蓋版本衝突、欄位/null 格式、admin 不可指定他人、停用拒絕、open/SQL 合成 paused 的預設變更不影響本場。migration 測試在既有場、基準及世代上套用 0006，確認資料保留。舊 pending 的自動化測試驗證顯示、保留、阻擋提交及明確丟棄；Ego 同樣實測這些狀態。

真 production Worker 路由和隔離 D1 的同時 HTTP `Promise.all` 停用／開場測試讀回合法序列結果；未在兩請求 SQL 邊界加入 barrier，不聲稱兩者同時抵達該邊界。另有在開場 batch 前以 DB wrapper 注入停用的補充測試。1101 筆分數逐筆核對；觸發器失敗驗證 batch 回滾。SIGKILL 測試是在確認已提交但呼叫方未收到結果後中止，不是提交中途未知是否提交。

### 雙分頁 Ego / 真 Worker + 本機 D1

隔離 19689 loopback fixture，合成登入；A 首次開場在轉發前被 fixture 阻斷，保留 ID `6efdced0-846a-4b32-a5a7-fe85702f3161`、群 111、世代 0。B 送出 ID `5983d136-2a96-433f-99e8-b8593980e052`、群 222 得 201；test-only fixture SQL 結束 B（不是 production 終點 API）。A 按重試首次將原 pending 送至 production Worker 得 409；current 為 null、世代 1；UI 隱藏重試與開場。對隱藏重試按鈕程式觸發第二次 activation，無額外 PUT、新 ID 或 pending；這不是實際可見按鈕點擊。使用者需明確重新讀取及確認，才可再次開場。實測當時最新 app 與 Worker；之後僅修改測試暫存路徑及此文件。

預設 UI 真實點擊儲存 456789，GET 回 version 1；開場 ID `437a46fd-b2f5-43cc-86cc-2550e5ee441d` 快照 456789；UI 再儲存 987654，GET 回 version 2，current 及重整後 current 均仍為 456789。用 fixture SQL 結束後，合成舊 localStorage 紀錄在重整後原文顯示並保留，未轉為 sessionStorage、未自動 PUT；明確點丟棄後紀錄移除，current 為 null、世代 2。fixture 已停止；19481 未更動。

## 待驗及後續票

真 Discord、真手機、遠端 D1、正式資產路由及費用仍待驗；以上不等於正式服務驗收。取消補償、winner 歸零及終結競態屬後續票；報名、群組成員檢查、抽選尚未實作，不能以此切片舉辦活動。未部署、未執行遠端 migration 或真帳號操作。
