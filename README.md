# Google Padlet

**v0.2.0｜教師 Google Drive 互動牆・開發預覽版**

一面牆，收藏全班的觀察、作品與回饋。教師使用自己的 Google 帳號連接 Drive，每面互動牆對應 `Google Padlet / 互動牆名稱` 資料夾。

作者：板橋國小 楊凱文。這是自主開發專案，並非 Google 或 Padlet 官方產品。

> 本版已實作可執行的前後端、Google OAuth 與 Drive API 串接；尚未使用實際學校 OAuth 憑證完成端到端驗收。上線前請依 [部署教學](docs/DEPLOYMENT.zh-TW.md) 設定並驗收。**不是完整 Padlet 替代品，也不是 Apps Script / GitHub Pages 靜態網站。**

## v0.2.0 新增

- 互動牆封存、回收與還原；首頁依使用中／封存／回收站篩選。
- 教師貼文回收站，還原內容、留言及附件關聯。
- 複製教學模板，沿用設定但清空學生作品、名單及截止時間。
- 臺灣時間截止設定：截止後學生全部寫入操作受限，教師可繼續管理。
- 每人 0～100 篇上限（0 不限），支援並行投稿檢查。
- CSV 成果匯出：僅已發布、未刪除貼文，排除帳號／內部 ID 並處理試算表公式注入。

操作及升級方式見 [v0.2.0 使用說明](docs/V0.2.zh-TW.md)。

## 已實作

- 教師 Google 登入、教師名單控制；學生登入不要求學生 Drive 權限。
- 每位教師各自授權 `drive.file`，授權憑證以 AES-256-GCM 加密保存。
- 每面牆獨立 ID、同名資料夾、改名同步；同教師禁止重名。
- 牆面、網格、分欄、串流四種版型；顯示切換不刪除內容。
- 文字貼文、分區、四種卡片色彩、搜尋作者／內容。
- PNG / JPEG / WebP 圖片、PDF 上傳，單檔 10 MB，每篇最多 5 件。
- 留言、刪除自己的留言、喜歡／取消喜歡、教師核准貼文。
- 學校網域與選填學生名單、自己的作品編輯／刪除、教師管理。
- 凍結互動牆，所有學生寫入 API 均檢查。
- 網址與 QR Code 分享、SSE 即時更新、文字草稿暫存、JSON 備份匯出。
- SQLite 交易、重複提交防護、編輯衝突提示。
- Drive 背景同步、狀態提示、失敗退避重試、手動重試。
- 教師、學生 01、學生 02 的本機示範角色。

## 先在自己的電腦試用

安裝 **Node.js 24 LTS** 與 Git，在終端機執行：

```bash
git clone https://github.com/coollinyoung/Google-padlet.git
cd Google-padlet
npm ci
npm run demo
```

用瀏覽器開啟 **http://localhost:3000**。

1. 以示範教師登入，建立互動牆。
2. 複製牆網址；在同一台電腦另一個瀏覽器或無痕視窗開啟。
3. 選學生登入，新增貼文、留言與附件。
4. 回到教師視窗檢查即時更新、開啟審核、凍結。

**示範模式只監聽 127.0.0.1，資料保存在 `demo-data/`，沒有上傳 Google Drive。** 不要將它經由反向代理／隧道公開。示範 QR Code 的 localhost 網址不能讓另一台手機加入；師生跨裝置使用需要正式 HTTPS 部署。

## 連接真正的 Google Drive

依 [繁體中文部署教學](docs/DEPLOYMENT.zh-TW.md) 完成：

1. 建立 Google Cloud 專案、啟用 Google Drive API。
2. 設定 OAuth 同意畫面、Web application 用戶端與回呼網址。
3. 複製 `.env.example` 為 `.env`，填寫 OAuth、教師名單及 32-byte 加密金鑰。
4. `npm start`，教師登入後按「連接 Google Drive」。
5. 建立互動牆，確認畫面出現「已保存至教師 Google Drive」。

學生使用互動牆網址登入，程式以教師的授權儲存附件；不把整個教師資料夾分享給學生。權限由後端檢查。

## 儲存方式

本版採規格 B 的單一伺服器實作：**Node.js + SQLite + SSE + Google Drive**。SQLite 是即時操作的權威資料來源，Drive 是教師可見的完整互動牆資料副本與附件原檔位置。資料也存在伺服器，並非 Drive-only 架構。

| Drive 路徑 | 本版內容 |
| --- | --- |
| `Google Padlet/互動牆名稱/board.json` | 名稱、版型、分區、權限等設定 |
| `Google Padlet/互動牆名稱/data.json` | 含貼文、留言、反應與附件 ID 的完整快照；含教師資料，不可直接公開 |
| `Google Padlet/互動牆名稱/attachments/` | 上傳附件，保持私人權限 |
| `…/backups/`、`…/exports/`、`…/thumbnails/` | 已建立的後續功能預留目錄，本版不自動填入 |

本版以 JSON 儲存結構資料，**尚未產生規格中的「互動資料」Google 試算表**。背景工作每 15 秒檢查，失敗以指數退避至最多約 5 分鐘；實際延遲受 Drive 配額、網路與牆數影響，並未保證 60 秒 SLA。

附件上傳成功才公開含附件的初始貼文；失敗會留下僅作者／教師可見的待完成稿，可再次編輯補傳，或以純文字發布。PDF 採下載，尚無內嵌預覽。圖片採受權限保護的應用程式網址，不公開 Drive 檔案。

## 開發與驗證

```bash
npm run check
npm test
npm run dev
```

測試包含 35 筆 HTTP 並行投稿、重複操作、版本衝突、越權讀寫、審核附件、凍結、Drive mock 的資料夾重用／改名／同步版本與重試。**HTTP 測試不是 35 位 Google 登入使用者的實際負載測試**。Drive mock 測試不等同真實 Google 服務驗收。

GitHub Actions 會執行語法檢查、自動化測試及依賴稽核。

## 版本範圍與下一步

- [完整開發規格與對照表](docs/SPEC.zh-TW.md)
- [後續開發清單](docs/ROADMAP.zh-TW.md)
- [架構、限制與資料維運](docs/ARCHITECTURE.zh-TW.md)
- [正式驗收清單](docs/ACCEPTANCE.zh-TW.md)
- [版本紀錄](CHANGELOG.md)

尚未實作：含作品／附件的完整牆複製、共同教師、訪客、拖曳排序、更多反應模式、自訂欄位、時間軸／橫列／表格／地圖／自由畫布、影音錄製、繪圖、私人評分、完整備份匯入、永久刪除、PDF 匯出、Classroom 與 AI、Sandbox 協作白板。這些保留為後續版本，不宣稱本版已與 Padlet 功能相同。

GitHub 儲存庫負責程式版次管理，**不會因 push 就自動架設可用網站**。正式網站必須另有 Node.js 主機、HTTPS 與持久磁碟。
