# 架構與維運

## 程式結構

| 路徑 | 職責 |
| --- | --- |
| `server/config.js` | 環境設定、禁止公開示範模式 |
| `server/auth.js` | OAuth state/nonce、身分驗證、伺服器 session、授權加密 |
| `server/store.js` | SQLite 表格與交易、操作冪等、同步版本、稽核 |
| `server/domain.js` | 存取權限、貼文／留言／反應／設定規則 |
| `server/drive.js` | 教師 Drive、資料夾與檔案、序列化同步佇列 |
| `server/app.js` | HTTP API、受保護附件、SSE、背景同步 |
| `public/` | 無建置步驟的繁體中文網頁、CSS、瀏覽器程式 |
| `tests/` | HTTP 整合與 Drive mock 測試 |

## 寫入與一致性

1. 後端從 HttpOnly session 識別使用者；前端無法指定作者。
2. 後端檢查牆權限、凍結狀態、貼文作者與審核狀態。
3. 同一 SQLite transaction 寫入牆資料、operation ID 和 audit。
4. SSE 僅傳「需要更新」通知，瀏覽器重新取得經過權限過濾的牆。
5. 背景每 15 秒檢查未同步版本，Drive 操作由一條 queue 序列執行。
6. 僅標記實際寫出的 snapshot version；途中新增內容仍維持 pending。
7. Drive 錯誤保留 SQLite 資料，以 30 秒起的退避重試，上限約 5 分鐘；教師可手動重試。

`board.json` 與 `data.json` 是兩次檔案寫入，不是跨檔案原子交易。復原資料以含完整貼文的 `data.json` 為準，`board.json` 為方便檢視的設定副本；比較 `version` 判斷是否一致。Drive 全部寫入完成才更新 sync_version。

資料夾以 Drive ID 與 `appProperties.gpKey` 對應；重試時優先找既有 ID。手動從 Drive 改名會在下一次同步被網頁設定名稱覆寫。手動移動但 ID 仍可讀時可繼續使用；v0.1.0 尚無移動提示或重新選取資料夾 UI。已知資料夾被刪除時回報失敗，不偷偷建立空白替代品。

## 安全界線

- 僅教師名單可建牆；只有建立者是管理者。共同教師尚未實作。
- 學生需通過已驗證 `hd` 及選填名單，持有網址不代表自動有權限。
- 所有變更要求與 BASE_URL 相同的 Origin；OAuth 使用一次性 state、cookie 綁定與 nonce。
- OAuth callback 驗證 ID token 的簽章、audience、issuer、expiry 與 nonce。
- 學生不能讀取教師 OAuth 憑證；tokens AES-GCM 加密，金鑰不在資料庫。
- 附件以 `/api/boards/.../attachments/...` 代理，每次重新檢查權限；不建立公開 Drive ACL。
- 使用純文字內文與 HTML escaping；不接受 HTML、SVG、任意腳本；遠端網址不抓取 metadata。YouTube iframe 與媒體元素由程式依驗證過的網址產生。
- Session 8 小時到期；正式 HTTPS cookie 設 Secure、HttpOnly、SameSite=Lax。
- SSE 會定時驗證 session／權限；內容事件只包含失效通知。
- 已下載到學生裝置的內容無法遠端收回；學校端權限變更阻止後續讀取。

## 已知限制

- 單程序／單節點，SQLite 同步操作與每牆 JSON 聚合適合開發與小規模先導試用，尚未測得正式承載量。
- 35 筆並行 HTTP 測試用同一測試學生，不等於 35 個真實 Google 登入客戶端與 Drive 同時上傳。
- SSE 斷線自動重連後重新取得快照；尚未提供離線提交佇列或多裝置草稿同步。
- sessionStorage 只存文字草稿；登出清除。共用電腦仍應確實登出並關閉瀏覽器。
- v0.1.0 附件只支援安全範圍內的圖片與 PDF，檢查檔頭，未提供病毒掃描、完整內容解碼驗證或影音轉碼。
- 上傳到 Drive 後若本機交易失敗，可能留下私人孤立附件；不會對學生提供網址。清理工具尚未實作，請教師／維運者核對 data.json 後清理。
- 軟刪貼文仍在完整快照，教師可從貼文回收站還原。刪除留言會從當前快照移除，audit 只記錄動作，不保留完整舊內文。
- 備份含姓名與身分 ID；只限教師下載，不應當成公開成果檔。
- 還原 Drive snapshot 到新伺服器的自動匯入工具尚未完成，不能只依賴 Drive 副本作唯一災難復原方案。
- 背景同步不會因教師登出停止；這是教師要求持續保存的 offline 授權用途。完整斷開功能尚未實作，可從 Google 帳號撤銷授權；同步會顯示失敗。

## 備份與還原（目前可用路徑）

正式試用前必須定期做伺服器備份：

1. 停止應用程式，避免複製到不一致的 SQLite/WAL。
2. 備份整個 DATA_DIR（包含資料庫與同目錄 WAL/SHM，若存在）。
3. 分開安全保存 TOKEN_KEY、Google OAuth 設定。不要放到公開 GitHub 或牆資料夾。
4. 確認教師 Drive 中附件仍存在；應另訂 Drive 附件保留與備份方式。
5. 還原時停止程式，放回整個 DATA_DIR，使用同一 TOKEN_KEY 與 OAuth client，重新啟動。
6. 若授權已失效，教師重新登入／連接 Drive；確認牆與附件。

教師按「匯出備份」取得該牆 JSON，與 Drive `data.json` 格式相同。它包含附件 ID，**不含附件二進位檔**，不應稱為自足的完整 ZIP 備份。

## 可擴充方向

將 Store 介面替換為 PostgreSQL 等資料庫、Drive queue 改為持久工作佇列、SSE 通知改為跨程序訊息；保留 boardId/postId 及 schemaVersion。多人白板需額外的協作狀態協定，不能直接套用貼文快照機制。

## v0.2.0 增量資料欄位

Board 新增可選 lifecycle（active/archived/trashed）、deadlineAt（UTC ISO/null）、maxPostsPerStudent（0～100）。未具有欄位的 v0.1 資料採 active/null/0。這是 schemaVersion 1 的向後相容新增，不改資料庫表格或現有 ID。

封存與回收是應用程式狀態，會寫入 Drive 快照，但不改 Drive 垃圾桶旗標。還原不清空原截止與凍結設定。模板複製只帶教學設定，產生新 boardId，Drive 同步依新 ID 建立獨立資料夾。

發文上限計算未刪除的學生貼文（含 pending/uploading），在同一寫入 transaction 內檢查；教師可還原超出目前上限的歷史作品，但學生仍不能繼續新增。截止時間以伺服器判斷為準，學生即使保留截止前頁面也無法繞過。

## v0.3.0 網址欄位

Post 新增可選 links 陣列，包含 url、kind、host；YouTube 額外含 videoId/startSeconds。新增／編輯僅接受網址字串陣列，所有衍生欄位由 server/links.js 產生。舊資料沒有 links 時視為空陣列。

瀏覽器按載入才建立 iframe/audio/video；一般 SSE 更新會先確認正在播放的貼文及連結仍可讀，再延後重繪。URL 原檔不進入 Drive，權限僅控制程式內貼文可見性；已取得的公開來源連結無法遠端收回。
