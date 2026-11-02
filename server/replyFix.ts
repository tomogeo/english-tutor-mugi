// Fixes to her chat reply, run on the server before it is sent as `done` (server/claudeChat.ts). The reply is the JSON
// object of CHAT_REPLY_SCHEMA (game/claudeProtocol.ts ChatReplyJson). Pure: no network.
//   1. when the 小提醒 should be in Chinese (tipLang 'zh') but came back as English prose (almost no Chinese outside <en>),
//      it is marked for a background rewrite (tipRewrite; the client calls /api/chat/fix-tip once for it);
//   2. in a Chinese tip, an English phrase the model forgot to wrap (two or more words outside <en>) is wrapped in <en>…</en>,
//      so the tip practice can find it;
//   3. a cut reply (the output limit) is read as far as it goes (game/replyJson.ts parsePartialJson) and written back in the
//      canonical form, so what is stored and sent back to Claude is always a complete, valid JSON object.
import { canonicalReplyJson, parsePartialJson, readReplyValue, toSegments } from '../src/game/replyJson.ts';
import type { ChatSegment, TipLang } from '../src/game/claudeProtocol.ts';

const EN = /<en>([\s\S]*?)<\/en>/g;
const HAN = /\p{Script=Han}/gu;
const LATIN = /[A-Za-z]/;
/**
 * A run of English outside <en>: two or more words of Latin letters (with ' and - inside words), separated by spaces, with
 * the sentence punctuation that follows. A lone word (a grammar term such as "past", or "-ed") is left as it is.
 */
const EN_RUN = /[A-Za-z][A-Za-z'’-]*(?:[ ,]+[A-Za-z][A-Za-z'’-]*)+[.!?]*/g;

export type FixOptions = { log?: (msg: string) => void; tipLang?: TipLang };

/** the text outside every <en>…</en>, after applying fn to each such piece */
function mapOutsideEn(text: string, fn: (s: string) => string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(EN)) {
    const at = m.index ?? 0;
    out += fn(text.slice(last, at)) + m[0];
    last = at + m[0].length;
  }
  return out + fn(text.slice(last));
}

/** the text outside every <en>…</en>, joined */
function outsideEn(text: string): string {
  let outside = '';
  mapOutsideEn(text, (s) => { outside += s; return s; });
  return outside;
}

/** English phrases (two or more words) outside <en> are wrapped in <en>…</en>. */
export function wrapEnglish(tip: string): string {
  return mapOutsideEn(tip, (s) => s.replace(EN_RUN, (m) => `<en>${m}</en>`));
}

/** A tip is Chinese when at least two Chinese characters stand outside <en>. */
export function isChineseTip(tip: string): boolean {
  return (outsideEn(tip).match(HAN)?.length ?? 0) >= 2;
}

/** Chinese characters a Chinese explanation needs before the tip stops counting as "an English tip" */
const CHINESE_PROSE_MIN = 6;

/**
 * The tip needs the background rewrite into Chinese: it has English prose outside <en> and hardly any Chinese. A Chinese
 * explanation that quotes English is fine as it is.
 */
export function needsTipRewrite(tip: string): boolean {
  const outside = outsideEn(tip);
  if (!LATIN.test(outside)) return false;
  return (outside.match(HAN)?.length ?? 0) < CHINESE_PROSE_MIN;
}

export type FixedReply = { json: string; tipRewrite: boolean };

/**
 * Her reply as it is shown and stored: the tip is read (see above) and the result is the canonical JSON. tipRewrite: the tip
 * should be Chinese but is English, and is to be rewritten in the background. Unreadable text (no JSON at all) comes back as
 * an empty reply, which the client reports as "no reply". With tipLang 'en' the tip is kept as the model wrote it.
 */
export async function fixReplyJson(raw: string, opts: FixOptions = {}): Promise<FixedReply> {
  const log = opts.log ?? (() => {});
  const tipLang: TipLang = opts.tipLang ?? 'zh';
  const value = parsePartialJson(raw);
  let strict = true;
  try { JSON.parse(raw); } catch { strict = false; }
  if (value === undefined) log(`[reply] no readable JSON in the reply (${raw.length} chars), sent empty`);
  else if (!strict) log(`[reply] reply cut or not valid JSON, the readable part is kept (${raw.length} chars)`);
  const fields = readReplyValue(value);
  const segments: ChatSegment[] = toSegments(fields).map((s) => ({ lang: s.lang, text: s.text, gloss: s.gloss }));
  const written = fields.tip.trim();
  if (tipLang === 'en') return { json: canonicalReplyJson({ segments, tip: written, tone: fields.tone }), tipRewrite: false };
  // the rewrite check reads the tip as the model wrote it (before wrapping)
  const tipRewrite = needsTipRewrite(written);
  const tip = tipRewrite ? written : wrapEnglish(written);
  if (tip !== written) log(`[tip] English in the tip wrapped in <en>: ${written.slice(0, 60)}`);
  return { json: canonicalReplyJson({ segments, tip, tone: fields.tone }), tipRewrite };
}
