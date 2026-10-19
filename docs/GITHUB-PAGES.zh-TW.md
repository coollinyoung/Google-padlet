# GitHub Pages 互動展示

此展示不是正式班級服務：不會連接 Google、沒有真正帳號驗證，角色僅為介面模擬。每位訪客各自使用自己的瀏覽器資料，不會看到其他訪客的貼文。請勿輸入真實學生個資。

## 首次啟用（儲存庫管理員）

1. 開啟 https://github.com/coollinyoung/Google-padlet/settings/pages 。
2. Build and deployment → Source 選擇 **Deploy from a branch**。
3. Branch 選擇 **gh-pages**，資料夾選 **/(root)**，按 Save。
4. 等待 GitHub 的 Pages 部署完成，再開啟 https://coollinyoung.github.io/Google-padlet/ 。
5. 若顯示 404，先確認 Pages 設定、Actions 的 Pages 部署狀態，再重新整理；不要把「程式已上傳」當成「網站已啟用」。

GitHub 規定 Pages 發布來源須由具有相應管理權限者設定。本專案的程式碼連接工具不提供 Pages 設定操作，因此初次啟用需由擁有者操作。官方說明：https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## 可體驗內容

- 預載示範牆、教師與兩位學生角色切換。
- 建牆、四種版型、五套主題與自訂底圖、貼文拖曳排序。
- 文字與影音網址、留言、喜歡、投票、審核、封存／回收與模板。
- 本機檔案附件儲存於 IndexedDB，每件最多 5 MB；附件排序與移除。
- JSON／CSV 匯出（JSON 不內含二進位附件）。
- 頁面上方「重設示範資料」會刪除本瀏覽器展示資料並重建示範牆。

資料會隨清除網站資料而消失。儲存容量依瀏覽器而異；儲存被禁止或空間不足時會顯示錯誤。建議使用單一分頁；不同裝置不會同步。媒體連結仍需外部服務允許播放。分享按鈕只複製展示站入口，不會分享個人瀏覽器裡的牆。

## 開發與更新

```sh
npm ci
npm run demo:build
```

產物為 `dist-demo/`，可用任意本機 HTTP 靜態伺服器預覽（不要直接雙擊 HTML）。輸出使用相對路徑，可置於 `/Google-padlet/` 子路徑。正式伺服器的 `npm start`、`npm run demo` 不受影響。

`main` 保存原始碼，`gh-pages` 只保存靜態產物。更新原始碼後須重新建置並將 `dist-demo` 的內容發布到 `gh-pages` 根目錄，Pages 才會更新；本版沒有自動同步兩個分支的工作流程。

建置只選取公開 UI、花紋、domain 規則及展示轉接程式，不複製伺服器設定、使用者資料庫或憑證。不要將整個專案／data／.env 放到 gh-pages。

自動化測試驗證共用規則、路徑、角色、投票、附件與儲存失敗回復；此環境未能安裝瀏覽器執行完整端到端測試，仍需在 Pages 啟用後實際驗收。
