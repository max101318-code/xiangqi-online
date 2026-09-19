# 中國象棋 Online v2.6.0

依使用者提供的中國象棋規則製作，並加入網站化功能。

## 本版新增
- 可儲存暱稱
- 內建表情頭像選擇
- 可上傳自訂圖片頭像，會縮小後儲存在瀏覽器
- 本機玩家戰績：勝場、敗場、勝率
- 雙人對局聊天室（WebSocket 即時同步）
- 聊天訊息最多 200 字、保留最近 100 則
- 保留原有猜拳、選色、30 秒倒數、悔棋、求和、斷線判勝、再戰、將軍動畫與語音

## 注意
目前「名字／頭像／勝敗戰績」是以瀏覽器 `localStorage` 保存的玩家資料，不是有密碼登入的雲端會員帳號。換瀏覽器或清除網站資料後會是另一份資料。

## 啟動
`npm install`

`npm start`

## Render
Build Command: `npm install`
Start Command: `npm start`

Render 連接 GitHub 後，Commit 到 main 會自動部署。
