# 設計決策紀錄（ADR）

> **英文版說明：** 這些紀錄寫於原本的日語版（[brian901106/japanese-tutor-mugi](https://github.com/brian901106/japanese-tutor-mugi)）。英文版拿掉了 VOICEVOX 與 kuromoji（漢字讀音），所以 0001 已刪除，其他紀錄裡提到日文、讀音或 VOICEVOX 的地方只是歷史背景；快取、防護、Structured Outputs 等設計在英文版仍然相同。

架構決策紀錄（Architecture Decision Record，ADR）記下一個重要設計決定的背景、考慮過的選項、最後的選擇與代價，讓之後的人知道「為什麼這樣做」，以及什麼情況下該重新檢討。

架構總覽圖：[overview.svg](../img/overview.svg)（一句話從送出到回來，哪些步驟是 AI、哪些是程式）。

| 編號 | 標題 | 狀態 |
| --- | --- | --- |
| 0001 | 地端語音：Claude 不必知道 VOICEVOX | 英文版已移除 |
| [0002](0002-prompt-cache.md) | 快取：不變的放前面，讓 Claude 記住 | 已採用 |
| [0003](0003-model-by-task.md) | 模型：看工作選大小 | 已採用 |
| [0004](0004-server-guards.md) | 防護：模型會出錯，程式來接 | 已採用 |
| [0005](0005-visible-fallback.md) | 降級：壞了也不亂答 | 已採用 |
| [0006](0006-tts-cache.md) | 語音快取：同一句不付兩次 | 已採用 |
| [0007](0007-structured-outputs.md) | Structured Outputs：格式交給 API 保證 | 已採用 |
| [0008](0008-persona-and-picture.md) | 人設與人設圖片：只換個性，換了重新開始 | 已採用 |
| [0009](0009-ai-routing-and-oauth.md) | AI 路由與登入：Claude 與 ChatGPT 依序備援 | 已採用 |

所有決定都依同一個判斷原則：**能用程式確定的就不交給模型；其次省 token。**

另有一份不編號的紀錄：[開源前的安全審查](security-review.md)（攻擊面、守門規則與測試方式）。
