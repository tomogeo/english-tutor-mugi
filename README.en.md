[繁體中文](README.md) | **English**

# English Tutor Mugi

A phone-friendly web app for one-on-one **English conversation practice** with Mugi, a cartoon hamster tutor powered by
Claude. Speak or type in English or Chinese; she answers in short, natural American English, with the Chinese meaning of
each sentence in brackets (shown, not spoken). When you make a mistake, she picks the most important one and explains it in
a 小提醒 (tip). The interface is in Traditional Chinese.

> **Adapted from** [brian901106/japanese-tutor-mugi](https://github.com/brian901106/japanese-tutor-mugi) (MIT License,
> Copyright (c) 2026 brian901106), changed from Japanese practice to English practice. The original copyright notice and
> the full MIT text are kept in [LICENSE](LICENSE); third-party components are listed in [NOTICE.md](NOTICE.md).

## What changed from the Japanese version

- She speaks English only (US); you can speak English or Chinese.
- Tip language switch (⚙️ 設定 › 學習 › 小提醒語言): Chinese (default) or simple English.
- Chinese meaning can be hidden (⚙️ 設定 › 學習 › 顯示中文翻譯) for listening practice.
- Three English-speaking characters: Mugi the hamster, Lily (an American high-school senior) and Ethan (an American college
  student). The pictures are the original ones.
- A new bank of 100 English conversation starters.
- 速查 (quick lookup) answers about English, with CEFR levels (A1–C2).
- Japanese-only parts are removed: kanji readings (kuromoji) and VOICEVOX. Speech recognition listens in English by default.

## Quick start

Requirements: Node.js 20+ and either a Claude (Anthropic) API key or a ChatGPT account.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Put your key in `ANTHROPIC_API_KEY` in `.env.local` (skip this if you only use ChatGPT, and sign in from the settings on
this PC), then:

```bash
npm run dev
```

Open <http://localhost:3004>. The server listens on this PC only. For a phone, use Tailscale Serve
(`tailscale serve --https=443 --bg http://127.0.0.1:3004`); never expose the server publicly, since anyone who can reach it
can spend your API credit.

Optional cloud voices: `GOOGLE_TTS_API_KEY`, or `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` in `.env.local`, then choose
them in ⚙️ 設定 › 聲音 › 英文.

## Development

```bash
npm test
```

```bash
npm run build
```

The tests never call a real API.

## Disclaimer and license

Not affiliated with or endorsed by Anthropic, OpenAI, Google or Microsoft. AI replies can be wrong. MIT License (see
[LICENSE](LICENSE)); the original author's notice is kept. The app icons still show the original name むぎ.
