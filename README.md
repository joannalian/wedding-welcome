# 好日子迎賓

婚宴當日使用的響應式 Web 工具，支援 iPhone 與 10 吋 iPad。前端可先以本機示範模式操作；連接 Google Apps Script 後，每場婚宴會在 Admin 的 Google Drive 建立獨立資料夾與試算表。

## 已完成

- 首頁分流「管理我的婚宴」與「查看示範」，示範資料使用獨立的本機儲存空間
- Admin 先使用指定 Google 帳號驗證，再選擇既有婚宴或建立新婚宴
- 等待接待名單、名稱／分類／桌次／電話末三碼搜尋
- 人數、紅包、喜餅、桌次四步接待引導
- 完成後自動移出候選名單，可由「已接待」修改或取消
- 可選填禮金金額；紅包袋姓名確認警告；喜餅欠餅登記
- 現場總覽與逐桌明細，跨桌部分抵達以比例均攤並標示估算
- Admin Excel／CSV 匯入差異預覽、Google Sheet 入口、禮金 CSV 匯出
- Admin 可複製不含 PIN 的接待人員／婚顧入口；工作人員不需 Google 或 ChatGPT 帳號
- Admin／接待人員／婚顧角色；關閉接待後僅 Admin 可查看
- Google Apps Script + Google Sheet 後端、PIN 登入與輪詢同步
- Apps Script 強制檢查 Admin 信箱與 OAuth Client ID，並限制短時間內的錯誤 PIN 嘗試

## 本機執行

```bash
npm install
npm run dev
```

未設定環境變數時仍可由首頁進入虛構資料示範；管理者與工作人員入口會清楚標示 Google 連線尚未啟用。

## GitHub Pages

正式靜態網址規劃為 `https://joannalian.github.io/wedding-welcome/`。`main` 分支更新後，GitHub Actions 會執行 `npm run build:pages` 並自動發布 `dist-pages`。

GitHub 儲存庫的 Actions variables 可設定：

- `VITE_APPS_SCRIPT_URL`：Apps Script Web App URL
- `VITE_GOOGLE_CLIENT_ID`：Google OAuth Web Client ID

未設定時會顯示不含真實個資的本機示範資料，適合先用手機測試版面。

## 連接 Admin 的 Google Drive

1. 在 Google Apps Script 建立專案，加入 `apps-script/Code.gs` 與 `apps-script/appsscript.json`。
2. 在指令碼屬性設定：
   - `ADMIN_EMAIL`：Admin 的個人 Gmail
   - `GOOGLE_CLIENT_ID`：Google OAuth Web Client ID
3. 將 Apps Script 部署為 Web App：以擁有者身分執行，允許知道網址的人存取。
4. 複製 `.env.example` 為 `.env.local`，填入 Apps Script Web App URL 與 Google Client ID。
5. 重新建置並部署網站。

建立婚宴後，系統自動產生婚宴代碼、接待 PIN、婚顧 PIN，以及獨立的 Google Drive 資料夾與 Google Sheet。

## 匯入欄位

支援目前「好日子排桌」匯出的欄位：桌次、分類、原始群組、姓名、電話、兒童座椅、素食、備註、中式喜餅數量（群組合計）、西式喜餅數量（群組合計）。明細列會依「分類 + 原始群組」合併為一筆賓客接待資料。
