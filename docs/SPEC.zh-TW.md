# Google Padlet 開發規格

規格基準：2026-10-16 使用者與開發者確認的互動牆構想。產品名稱為開發名稱，介面標示自主開發、非官方。

## 核心要求

1. 教師登入自己的 Google 帳號並連接自己的 Drive。
2. 每面互動牆對應 `Google Padlet / 同名資料夾`；固定 boardId/folderId，改名不改網址。
3. 學生用網址或 QR Code 進入，以學校 Google 帳號登入；不授權學生 Drive。
4. 所有功能須從後端執行權限檢查，學生不獲得教師資料夾編輯權。
5. 正式長期方向採即時後端／資料庫 + Drive 完整保存副本。
6. 以逐項功能清單驗收 Padlet Board 對標程度；Sandbox 白板為獨立擴充。

## 功能對照

「完成」表示程式已實作並有對應本機／模擬測試，不表示已通過真實學校帳號、瀏覽器或正式負載驗收。

| 編號 | 規格 | v0.3.0 狀態 |
| --- | --- | --- |
| AUTH-01 | Google 登入、教師名單、學生身分 | 完成；真實 OAuth 待驗收 |
| AUTH-02 | 學校網域與學生名單 | 完成；單網域 |
| AUTH-03 | 共同教師、投稿者／回應者／閱讀者角色 | 部分：只有擁有者／學生投稿者 |
| AUTH-04 | 訪客、對同學匿名 | 待開發 |
| DRIVE-01 | 每教師根目錄、每牆同名資料夾 | 完成；真實 Drive 待驗收 |
| DRIVE-02 | ID 關聯、改名、同名衝突 | 完成 |
| DRIVE-03 | 貼文、留言、反應與設定保存 | 完成：JSON 副本，尚無 Google 試算表 |
| DRIVE-04 | 附件保存在教師 Drive | 完成：圖片及 PDF，待真實驗收 |
| DRIVE-05 | 同步狀態、重試、禁止舊版本誤標已存 | 完成 |
| DRIVE-06 | 手動移動偵測、重新連結、完整備份匯入 | 待開發；已刪資料夾會阻擋同步 |
| DRIVE-07 | 複製牆／附件、封存、回收與永久刪除 | 部分：模板複製、封存／回收與還原完成；完整作品複製與永久刪除待開發 |
| BOARD-01 | 名稱、說明、版型 | 完成 |
| BOARD-02 | 圖示、背景、封面、字型、收藏 | 待開發 |
| LAYOUT-01 | Wall/Grid/Columns/Stream | 完成；分欄以設定與貼文編輯移動 |
| LAYOUT-02 | Timeline/Rows/Table | 待開發 |
| LAYOUT-03 | Map/Freeform 與連線 | 待開發 |
| POST-01 | 文字標題／內文、顏色、分區、編輯刪除 | 完成；純文字 |
| POST-02 | 富文字、超連結卡片、標籤、置頂、複製 | 待開發 |
| POST-03 | 拖放檔案、貼上圖片、手動／多種排序 | 待開發 |
| POST-04 | 自訂欄位與必填規則 | 待開發 |
| MEDIA-01 | 圖片上傳／顯示、PDF 下載 | 完成；無 PDF 內嵌預覽 |
| MEDIA-02 | 錄音、錄影、螢幕錄製、繪圖 | 待開發 |
| MEDIA-03 | YouTube、外部網址、Google 文件引用 | 部分：一般網址、YouTube、HTTPS 影音直連完成；文件原生預覽待開發 |
| INTERACT-01 | 留言、自己的留言刪除、喜歡／取消 | 完成 |
| INTERACT-02 | 巢狀回覆、留言編輯、星等／評分等反應 | 待開發 |
| TEACH-01 | 人工審核、凍結、教師管理 | 完成 |
| TEACH-02 | 截止時間、每人篇數、先發文後看他人 | 部分：截止與每人上限完成；先發後看待開發 |
| TEACH-03 | 私人回饋／評分、班級統計 | 待開發 |
| SHARE-01 | 網址、QR Code | 完成 |
| SHARE-02 | 活動代碼、嵌入、站內通知 | 待開發 |
| SEARCH-01 | 搜尋貼文標題、內文、作者 | 完成 |
| SEARCH-02 | 多條件篩選、顏色／審核狀態／欄位 | 待開發 |
| EXPORT-01 | 教師 JSON 匯出 | 完成；附件僅 ID 引用 |
| EXPORT-02 | PDF/圖片/CSV/完整 ZIP、可還原備份 | 部分：CSV 完成，其餘待開發 |
| RELIABLE-01 | 冪等、交易、編輯版本衝突、SSE | 完成 |
| RELIABLE-02 | 真實 40 人／三班 120 人負載測試 | 待驗收 |
| EXT-01 | Classroom、AI 審核、Sandbox | 後續獨立規劃 |

## 目標資料結構

目前 Board 內包含設定、sections、posts；Post 內包含 comments、likes、attachments。SQLite 另存 users、sessions、oauth_states、operations、visits、audit。後續可拆分為獨立表格，但保留穩定 ID 與 schemaVersion。

後續擴充：Member 角色、Assessment 私人回饋、CustomField、Revision 完整版本歷程、Backup 可還原封裝。私人評量不得進入學生公開 API 或公開成果匯出。

## 不可退讓的驗收條件

- 不以名稱作為唯一資料關聯。
- 不讓學生互相覆蓋貼文；重送不重複計票或投稿。
- 不把 pending 與 uploading 貼文及附件暴露給其他學生。
- 不把 SQLite 已保存標示成 Drive 已完成。
- 不把示範模式當成正式授權或真實 Drive 保存。
- 不把「預留資料夾」或「可見按鈕」算成已完成功能。
- 不把原始外部連結視為已備份的附件。
- 各版型切換不得刪除專用資料。

## 對標資料來源

功能會變動，後續開發每一模組前應核對官方最新文件：

- Padlet Board：https://padlet.com/site/board/
- 版型名詞：https://padlet.help/l/en/article/mzqmxwiauk-lingo
- 留言：https://padlet.help/l/en/article/a58vggdr6g-untitled-article-0nn
- 反應：https://padlet.help/l/en/article/kdpo2vjj1s-
- 凍結：https://padlet.help/l/en/article/0ue2hz5mfx-freeze-padlet-boards
- Drive scopes：https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Drive quotas：https://developers.google.com/workspace/drive/api/guides/limits
