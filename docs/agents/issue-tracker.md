# Issue tracker: GitHub

本專案的 issues 與 PRDs 發布至 harukaxxxx/win-wuwa 的 GitHub Issues。
使用 gh CLI，明確指定 --repo harukaxxxx/win-wuwa。

- 建立：gh issue create --title "..." --body-file <markdown-file>
- 讀取：gh issue view <number> --comments；另取得 body、labels。
- 列出：gh issue list，依工作範圍指定 state、label，完整處理分頁。
- 評論：gh issue comment <number> --body-file <markdown-file>
- 標籤：gh issue edit <number> --add-label 或 --remove-label
- 關閉：gh issue close <number>

上述指令均指定本專案 --repo。
發布後讀回該 issue，核對正文及標籤。

PRs as a request surface: no.

「publish to the issue tracker」表示建立 GitHub issue。
「fetch the relevant ticket」表示讀取指定 issue 與評論。
