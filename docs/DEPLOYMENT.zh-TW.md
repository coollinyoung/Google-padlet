# 部署教學（v0.1.0）

## 1. 先選擇部署位置

本專案是 Node.js 後端應用，需 Node.js 24、可寫入的持久磁碟、HTTPS 網址。可部署於學校伺服器、VPS 或有 persistent volume 的容器主機。

- GitHub Pages 無法執行後端、OAuth 回呼、SQLite 或 Drive 同步。
- 不適合把目前 SQLite 程式直接放到無持久磁碟的 serverless 執行環境。
- v0.1.0 只啟動一個 Node.js 程序／容器，不要設定多副本或 PM2 cluster。
- 若學校網路不能對外提供 HTTPS，可選可持續運作的雲端主機；不要以示範模式替代正式身分驗證。

## 2. 建立 Google OAuth

使用有權管理專案的教師／管理員帳號：

1. 在 Google Cloud Console 建立專案。
2. 啟用 **Google Drive API**。
3. 在 Google Auth Platform／OAuth 同意畫面設定應用程式名稱、聯絡資訊、對象。
4. 只供同一 Workspace 組織使用時，依帳號與管理權限選擇適用的內部對象；跨組織使用需外部設定與適用的驗證程序。
5. 測試階段若為外部測試模式，加入實際測試師生帳號；確認學校管理端允許此 OAuth 應用。
6. 建立 **Web application** OAuth 用戶端。
7. 設定「已授權重新導向 URI」：
   - 本機：`http://localhost:3000/auth/callback`
   - 正式：`https://您的網域/auth/callback`
8. 取得 Client ID、Client secret，僅填進伺服器 `.env`，不要上傳 GitHub。

使用的 scopes：`openid`、`email`、`profile`。教師另點「連接 Google Drive」時增量要求 `https://www.googleapis.com/auth/drive.file`。沒有請求學生 Drive scope。

Teacher 與學生帳號是兩種應用程式角色，不由 Workspace 帳號本身推測。`TEACHER_EMAILS` 必須填入實際教師。

參考官方文件：
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

## 3. 設定環境變數

Windows PowerShell：

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

macOS / Linux：

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

把產生的 64 字元十六進位值填入 `TOKEN_KEY`。這是伺服器加密金鑰，請安全備份；遺失後無法解密既有教師 Drive 授權。

| 變數 | 用途 |
| --- | --- |
| `BASE_URL` | 實際網站來源，例如 `https://padlet.school.example`，不含子路徑或尾端斜線 |
| `HOST` | 本機 `127.0.0.1`；容器依設定 `0.0.0.0` |
| `PORT` | 預設 3000 |
| `DATA_DIR` | SQLite 及私有資料目錄，必須持久保存 |
| `TOKEN_KEY` | 64 個十六進位字元，不可提交到 Git |
| `GOOGLE_CLIENT_ID` | OAuth Web application Client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth secret |
| `TEACHER_EMAILS` | 逗號分隔教師完整 email，小寫 |
| `DEFAULT_DOMAIN` | 預設允許的 Google Workspace `hd` 網域，預設 `pcps.ntpc.edu.tw` |
| `NODE_ENV` | 正式站填 `production` |
| `DEMO_MODE` | 正式站必須 `false` |

`hd` 是 Google 驗證過的組織網域；不要假定一定與 email 後綴一致。若學校採別名網域，請與管理員確認。v0.1.0 學生限定名單同時要求符合指定 `hd` 與 email 網域，別名網域支援列為後續工作。

## 4. 啟動與首次使用

```bash
npm ci
npm run check
npm test
npm start
```

1. 使用教師名單內帳號登入。
2. 首頁按「連接 Google Drive」，同意程式檔案存取。
3. 建立牆，等待同步。
4. 在教師自己的 Drive 確認 `Google Padlet / 牆名 / board.json`、`data.json`。
5. 用學生帳號測試掃碼進入、發文、圖片上傳。
6. 用另一位不在名單／不同網域的帳號測試拒絕存取。
7. 畫面顯示「已保存至 Drive」才表示該版本快照已寫入完成；不能把「伺服器已保存」當成 Drive 已完成。

外部 OAuth 測試狀態的 refresh token 可能有期限；長期運作請按 Google 當時政策完成適用的正式設定。使用者撤銷授權也會中斷同步，教師應重新連接。

## 5. Docker（可選）

先設定正式 `.env`（HTTPS BASE_URL、OAuth、金鑰）：

```bash
docker compose up -d --build
docker compose logs -f app
```

Compose 的 `padlet-data` volume 保存資料；不要執行 `docker compose down -v`，除非確定要刪除全部伺服器資料。

反向代理指向 `http://127.0.0.1:3000`。Nginx location 範例：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    client_max_body_size 12m;
}
```

另配置 TLS 憑證與 HTTP 到 HTTPS 轉址；本範例不是完整 Nginx 設定。停用代理快取，保留 SSE 連線，禁止快取 `/api/` 與 `/auth/`。

## 6. 常見問題

| 現象 | 處理 |
| --- | --- |
| 啟動要求 OAuth 設定 | 未設定 `.env`；若只試畫面，使用 `npm run demo` |
| `redirect_uri_mismatch` | 比對 Google Console 與 BASE_URL 的回呼網址，含 http/https、主機與 port |
| 登入後無建立按鈕 | 該帳號不在 TEACHER_EMAILS；修正後重啟並重新登入 |
| 沒有存取牆權限 | 比對實際 `hd` 網域、牆設定及學生名單 |
| Drive 一直同步失敗 | 檢查 API、授權、空間、資料夾是否被刪除；重新連接 Drive 後重試 |
| 待完成附件一直不發布 | 作者重新編輯補傳；也可清空檔案選擇，以純文字儲存發布 |
| 出現「請從本站頁面操作」 | BASE_URL 必須與瀏覽器實際來源完全一致，包含協定與 port |
| 手機無法開啟 localhost QR Code | localhost 指手機自己；需正式 HTTPS 網址 |
| 重新部署後資料不見 | DATA_DIR 沒有持久化；先停止寫入並從伺服器備份還原 |

正式課堂使用前，逐項完成 [驗收清單](ACCEPTANCE.zh-TW.md)。
