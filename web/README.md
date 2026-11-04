# Mugi 英語家教（Claude 網站版）

不用安裝的精簡版，放在 claude.ai，用自己的 Claude 帳號聊天（不需要 API 金鑰）：
https://claude.ai/artifact/PZWifbeZPHJPz8tY3K6xak

- `page.src.html`：頁面原始碼（`__TOPICS__` 會換成 `topics.json` 的 100 句開話題）
- `index.html`：組好的頁面（發布用）
- 圖片來自 `public/backgrounds/` 與 `public/characters/`，發布時以 `img/...` 路徑一起上傳

聊天、速查與口說判斷透過頁面的 `sample` 功能呼叫 Claude；對話紀錄、小提醒本與設定只存在使用者自己的瀏覽器（localStorage）。
