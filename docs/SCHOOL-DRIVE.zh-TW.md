# 學校 Drive 連線與觸控驗收（v0.4.1）

## 先在教師電腦完成真實 Drive 測試

這是正式 Google 帳號授權；不使用 `npm run demo`。本機可先測試教師 Drive，完成後再部署 HTTPS，供手機與全班使用。本機 localhost 不會讓其他電腦或手機連到老師的伺服器。

1. 於 Google Cloud Console 建立／選擇學校可管理的專案，啟用 Google Drive API。
2. 於 Google Auth Platform 設定應用程式對象與聯絡資訊。只有符合 Workspace 組織條件才可選內部；外部測試需加入測試使用者。
3. 建立「Web application」OAuth 用戶端，加入重新導向 URI：`http://localhost:3000/auth/callback`。
4. 若學校封鎖第三方 OAuth，請有權限的 Workspace 管理員以此 OAuth Client ID 配置允許的應用程式存取。這不是安裝 ChatGPT 的 Google Drive 連接器。
5. 在程式資料夾執行下列 PowerShell 指令；已經有 `.env` 時不覆寫：

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

填入／確認：

```dotenv
PORT=3000
HOST=127.0.0.1
BASE_URL=http://localhost:3000
DATA_DIR=./data
GOOGLE_CLIENT_ID=填入用戶端ID
GOOGLE_CLIENT_SECRET=填入用戶端密鑰
TOKEN_KEY=填入64字元十六進位金鑰
TEACHER_EMAILS=您的完整學校Google帳號
DEFAULT_DOMAIN=pcps.ntpc.edu.tw
DEMO_MODE=false
NODE_ENV=development
```

首次產生 TOKEN_KEY：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

已有金鑰請沿用並備份，不要每次重建。Client secret、TOKEN_KEY 只留在伺服器，不貼到聊天或 GitHub。

6. 執行 `npm run doctor`，確認格式與重新導向 URI；此工具不連線 Google，也不輸出密鑰內容。通過只代表本機設定格式合格，不代表 Google 已允許此應用。
7. 執行 `npm start`，開啟 `http://localhost:3000`，使用 TEACHER_EMAILS 內的同一帳號登入，再按「連接 Google Drive」。
8. 點右上「Drive 連線檢查」。CONNECTED 表示授權帳號與 Drive API 讀取檢查通過；不代表寫入已驗收。
9. 建立名稱不重複的「Drive 連線驗收」互動牆，新增貼文、底圖，點「重新同步」。等待「已保存至教師 Google Drive」，到該教師 Drive 確認 `Google Padlet / Drive 連線驗收 / board.json`、`data.json` 與 `attachments`。圖片不應公開分享。
10. 修改貼文、拖曳排序、投票，再同步並確認 `data.json` 版本與內容有更新。關閉並重啟伺服器後，登入並再次同步，驗證授權與資料有保留。

示範模式資料存在 demo-data；正式模式預設 data，兩者是不同資料集，不會自動搬移示範學生資料。

## 連線檢查代碼

| 代碼 | 下一步 |
| --- | --- |
| DEMO | 改用正式 `.env` 與 `npm start` |
| NOT_CONNECTED | 教師授權連接 Drive |
| CONNECTED | 讀取正常，接著以測試牆驗證寫入 |
| REAUTHORIZE | 用原教師帳號重新授權 |
| ACCOUNT_MISMATCH | 切回登入的原教師帳號 |
| ACCESS_DENIED | 檢查 Drive API 啟用、授權範圍及學校第三方應用政策；此結果不斷言是哪一項原因 |
| FOLDER_UNAVAILABLE | 檢查原資料夾是否刪除或進入垃圾桶，先在 Drive 還原 |
| STORAGE_FULL | Google 回報空間不足，請釋放空間或聯絡管理員 |
| RATE_LIMIT | 稍候重試 |
| CONNECTION_FAILED | 檢查伺服器對外網路；若持續失敗，記錄檢查代碼與畫面訊息 |

## 手機／平板觸控驗收

先依 DEPLOYMENT.zh-TW.md 部署可供裝置連線的正式 HTTPS 網址，設定 BASE_URL，並在同一 OAuth 用戶端加入 `https://您的網域/auth/callback`。使用單一後端程序與持久磁碟。

- iPad Safari、Android Chrome 各測一次；先記下裝置型號與瀏覽器版本。
- 教師建立至少 15 篇長短不同貼文，按住「拖曳排序」把手移動。卡片一般內容仍可正常滑動捲頁。
- 手指移到頁面上／下邊緣，保持不動，確認持續捲動，放開後順序保存。
- 分欄版型把手移到貼文區左／右邊緣，確認橫向捲動。移至另一欄卡片上半部／下半部，放開後在其前／後插入。
- 拖曳時切到其他 app／瀏覽器分頁，或發生觸控取消，確認不會繼續移動或送出排序；外接鍵盤 Escape 可取消。
- 第二隻手指不應接管進行中的拖曳。↑／↓ 按鈕可作為替代操作。
- 另一裝置登入學生帳號，確認無排序把手；老師排序後學生看到相同順序。
- 上傳底圖後持續增加貼文，確認背景延伸、卡片可閱讀；測試投票與取消。

目前自動化涵蓋指標事件與取消流程，但不代表實體 iPad／Android 驗收完成。請記錄每項實測結果，再投入正式課堂。

## 官方參考

- OAuth Web server： https://developers.google.com/identity/protocols/oauth2/web-server
- Drive 授權範圍： https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Drive 連線檢查使用 about.get，支援既有 drive.file 範圍： https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get
- Workspace 應用程式存取控制： https://support.google.com/a/answer/7281227
