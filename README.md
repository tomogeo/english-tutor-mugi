**繁體中文** | [English](README.en.md)

# Mugi 英語家教 · English Tutor Mugi

這是一個適合手機使用的網頁 app，讓你和倉鼠 Mugi 一對一練**英語會話**。Mugi 是由 Claude 驅動的卡通倉鼠家教：你用英文或中文跟她說話，她用簡短、自然的美式英文回答，每句後面附上中文意思；你說錯的地方，她會挑最重要的一個給你「小提醒」。介面是繁體中文。

> **改編自：** 本專案改編自 [brian901106/japanese-tutor-mugi](https://github.com/brian901106/japanese-tutor-mugi)（倉鼠むぎ日語家教，MIT 授權，Copyright (c) 2026 brian901106），把「學日文」改成「學英文」。原作者的版權聲明與 MIT 授權全文保留在 [LICENSE](LICENSE)，第三方元件見 [NOTICE.md](NOTICE.md)。

## 和日語版有什麼不同

- **學的是英文**：她只說英文（美式），括號裡是中文意思（不會唸出來）。你用中文說，她會教你那句英文怎麼說。
- **小提醒語言可切換**：⚙️ 設定 › 學習 › 小提醒語言，選「中文」（預設，用中文解釋錯誤）或「English」（用簡單英文解釋，全英文沉浸）。
- **中文翻譯可關閉**：⚙️ 設定 › 學習 › 顯示中文翻譯，關掉後只看英文，適合練聽力。
- **三個說英文的角色**：倉鼠 Mugi、美國高三女生 Lily、美國大學生 Ethan（圖片沿用原版）。可以在「人物」裡改名字和個性，也能新增角色。
- **100 句英文開話題題庫**：日常生活、興趣、旅行、美食、在越南的生活等，不呼叫 API。
- **速查改查英文**：問「這句話英文怎麼說」「used to 是什麼意思」，回傳英文說法、中文意思、CEFR 等級（A1 最簡單～C2 最難）、文法與例句。
- **拿掉日文專用功能**：漢字讀音（kuromoji）與 VOICEVOX 日文語音都移除了；語音辨識預設聽英文（聊天列的「英／中」可切換）。

## 功能

- **英語會話**：她每次最多回兩句英文，依你的程度用短句、常用字。點一下她的話可以再聽一次。
- **小提醒本**：每則小提醒裡要學的英文會存進小提醒本，你可以「示範」聽發音，再開口或打字「練習」；本機比對（不分大小寫、標點）對不上時，才請 AI 判斷意思和文法對不對。
- **速查**：中英文都能問，查詢紀錄留在這台裝置上。
- **語音朗讀與嘴型**：英文和中文可以分別選「裝置內建」（免費，預設）、Google 或 Azure 語音（美式英文聲音，如 Ava、Emma、Andrew）。
- **語音輸入**：用瀏覽器的語音辨識說英文；也可以開「語音對話」連續聊。
- **人物、背景與聲音**：最多 8 位角色，各自有名字、個性、圖片、聲音與聊天紀錄；背景預設是教室。
- **用量面板與每日花費上限**（預設每天 2 美元）。

## 快速開始（一步一步）

這個 app 要在**你的電腦上執行**（它需要一個小伺服器替你保管 AI 金鑰），不能像一般網頁直接打開網址就用。

### 1. 先準備兩樣東西

1. **Node.js**（20 版以上）：到 <https://nodejs.org/> 下載「LTS」版安裝，一路按「下一步」即可。
2. **AI 服務，二選一**：
   - **Claude API 金鑰**：到 [Anthropic Console](https://console.anthropic.com/) 註冊、儲值，建立一組 API key（以 `sk-ant-` 開頭）。建議同時在 Console 設定每月消費上限。
   - 或 **ChatGPT 帳號**：不需要金鑰，啟動後在 app 的設定裡登入即可（用量算在你的 ChatGPT 方案）。

### 2. 下載程式

在 GitHub 這個專案頁面按綠色的「Code」→「Download ZIP」，解壓縮到一個資料夾（例如桌面的 `english-tutor-mugi`）。

### 3. 安裝與設定

打開終端機（Windows：開始選單搜尋「PowerShell」；Mac：搜尋「終端機」），用 `cd` 進到剛剛的資料夾，然後執行：

```bash
npm install
```

接著複製設定檔（Windows 用第二行）：

```bash
cp .env.example .env.local
```

```bash
copy .env.example .env.local
```

用記事本打開 `.env.local`，在 `ANTHROPIC_API_KEY=` 後面貼上你的 Claude 金鑰並存檔（只用 ChatGPT 的話可以跳過）。

### 4. 啟動

```bash
npm run dev
```

在電腦的瀏覽器打開 <http://localhost:3004> 就能開始聊天。要結束時，在終端機按 `Ctrl + C`。下次使用只要再做第 4 步。

> **提醒：** 預設只有這台電腦能連上。要在手機上用，請看下面「用手機使用」。不要把伺服器開放到網路上：能連到它的人都能花掉你的 AI 額度。

## AI 服務與語音

- **Claude**：聊天、速查、小提醒判斷與改寫。預設模型是 Haiku 5.5（最省），設定裡可以改成 Sonnet 5.5 或 Opus 5.5（較聰明、較貴）。以每日 2 美元的上限來說，用 Haiku 大約可以聊幾千句。
- **ChatGPT**：在電腦上打開 app，⚙️ 設定 › AI 服務 › 「用 ChatGPT 登入」。兩個都設定時，會依你排的順序使用，出錯自動換另一個。
- **金鑰也可以在 app 裡填**：在電腦上打開 app，⚙️ 設定的「金鑰」可以填 Claude、Google、Azure 的金鑰，會寫進電腦上的 `.env.local`，畫面只顯示末四碼。手機上只能看狀態。
- **語音（選用）**：預設用裝置內建語音，不用設定。想要更自然的聲音，可在 `.env.local` 填 `GOOGLE_TTS_API_KEY`（Google Cloud Text-to-Speech），或 `AZURE_SPEECH_KEY` 與 `AZURE_SPEECH_REGION`（Azure AI Speech），然後在 ⚙️ 設定 › 聲音 › 英文 選擇。兩者都有每月免費額度（實際額度以官方價格頁為準）；用量到 90% 時會自動換到較便宜的層級，最後才改回裝置語音。

## 用手機使用

iPhone 的語音辨識需要 HTTPS 網址。最簡單安全的做法是 [Tailscale](https://tailscale.com/download)：

1. 在電腦和手機都安裝 Tailscale，用同一個帳號登入。
2. 在電腦上啟動 app（`npm run dev`），再開一個終端機執行：

   ```bash
   tailscale serve --https=443 --bg http://127.0.0.1:3004
   ```

   執行 `tailscale serve status` 可以看到網址（例如 `https://你的電腦.xxx.ts.net`）。
3. 如果手機出現 "Blocked request" 或 "host not allowed"，請先停掉 app，在同一個終端機設定 `MUGI_ALLOWED_HOSTS=你的電腦.xxx.ts.net` 再執行 `npm run dev`。
4. 在手機打開那個網址，可以「加入主畫面」當成 app 使用。

不要使用 Tailscale Funnel 或公開的代理伺服器。也可以在信任的 Wi-Fi 上設定 `MUGI_LAN=1` 讓同網段連線（會要求輸入配對碼），細節見 `.env.example`。

## 資料與隱私

- **金鑰留在電腦上**，只有電腦上的伺服器讀得到，不會傳到手機。
- **聊天內容**會送到你選的 AI 服務（Claude → Anthropic，ChatGPT → OpenAI）；選了 Google 或 Azure 語音時，要唸的英文會送到那些服務。
- **聊天紀錄、小提醒、速查紀錄與設定**存在你所用裝置的瀏覽器裡；人物與背景圖片也只存在瀏覽器。
- **語音快取與用量統計**存在電腦上的 `.tts-cache/`、`.usage/`，ChatGPT 登入資料在 `~/.mugi-tutor/`，都不會被上傳到 GitHub。

## 安全性（重點）

- 預設只監聽這台電腦（`127.0.0.1`）。
- 每個 `/api` 請求都會檢查來源，拒絕其他網站發出的請求；寫入金鑰、登入 ChatGPT 只能在這台電腦上操作。
- 每分鐘聊天次數上限（`MUGI_CHAT_PER_MINUTE`，預設 20）與每日花費上限（`MUGI_DAILY_USD`，預設 2 美元，可在設定裡改）。這是估算值，實際帳單以 Anthropic Console 為準。
- 完整說明見原作者的 [docs/decisions/security-review.md](docs/decisions/security-review.md) 與 `.env.example`。

## 開發

```bash
npm test
```

```bash
npm run build
```

測試不會呼叫任何真實的 API。設計決策紀錄在 [docs/decisions/](docs/decisions/README.md)（寫於日語版，大部分設計在英文版相同）。

## 聲明

本專案與 Anthropic、OpenAI、Google、Microsoft 無關聯，也未獲其認可。AI 的回覆可能有錯，學習時請自行判斷，重要內容請對照可靠的來源。App 圖示上的字仍是原版的「むぎ」。

## 授權

本專案以 [MIT 授權](LICENSE)釋出，保留原作者 brian901106 的版權聲明。程式碼、`public/characters/` 的人物圖、`public/backgrounds/classroom.webp`、app 圖示與背景音樂（`public/audio/bgm.mp3`，原作者以 YuE2 生成）皆來自原專案，依 MIT 授權使用。第三方元件（例如 soundtouchjs，LGPL-2.1）列在 [NOTICE.md](NOTICE.md)。
