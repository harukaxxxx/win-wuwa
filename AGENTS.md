# win-wuwa 開發約定

此專案只維護 Who Is Next 的鳴潮布景與部署宿主。先讀 ../who-is-next/AGENTS.md、../who-is-next/CONTEXT.md 與 ../who-is-next/docs/development-plan.md。

共用 UI、操作流程、後端、migrations、測試與規格屬於 ../who-is-next；不要複製回來。此處只改 theme/、必要接線及宿主驗證。主題只呈現已持久化結果，不接管抽選與恢復。

驗證兩側：此處 npm run typecheck、npm test；完整產品回歸在 ../who-is-next 執行 npm test。沒有額外授權不可 commit、push、部署或改遠端資料。
