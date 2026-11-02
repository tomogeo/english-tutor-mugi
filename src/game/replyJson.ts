// Her reply as JSON (game/claudeProtocol.ts ChatReplyJson): the pure helpers the server (server/claudeChat.ts, server/replyFix.ts)
// and the client (game/claudeBrain.ts) share. No network, no DOM, no storage; the only import is the tone vocabulary.
//   - parsePartialJson reads a JSON text that may be cut anywhere (the stream while it arrives, a truncated reply);
//   - readReplyValue takes the fields out of whatever that read gives, with each field's type checked;
//   - canonicalReplyJson writes the one canonical form (fixed key order, no spaces): what is stored and sent back to Claude.
import { CHAT_TONES, type ChatReplyJson, type ChatSegment } from './claudeProtocol.ts';

/** a tone of her reply (the vocabulary of CHAT_TONES) */
type ChatTone = (typeof CHAT_TONES)[number];

/** A segment as it reads: lang is undefined until the key has come (or when it is not 'en' / 'zh'). */
export type ReplySegment = { lang?: 'en' | 'zh'; text: string; gloss: string };
/** The fields of a reply as they read. tip is '' when there is none; tone is undefined until it has come. */
export type ReplyFields = { segments: ReplySegment[]; tip: string; tone?: ChatTone };

/** Where a JSON text stands: whether its first top-level array (the segments) has closed. Structure only, nothing is validated. */
export function scanJson(text: string): { arrayClosed: boolean } {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let arrayClosed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      const open = stack.pop();
      // an array directly inside the top-level object (depth 1 once it is popped) is the segments array
      if (ch === ']' && open === '[' && stack.length === 1) arrayClosed = true;
    }
  }
  return { arrayClosed };
}

/**
 * The JSON text with what is missing added: an open string is closed (a dangling backslash dropped), a trailing comma is
 * dropped, a colon gets null, and every open { or [ is closed. The result may still be invalid (a key with no value yet);
 * parsePartialJson then gives undefined.
 */
export function repairJson(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = text;
  if (inString) {
    if (escaped) out = out.slice(0, -1);
    out += '"';
  }
  out = out.replace(/\s+$/, '');
  if (out.endsWith(',')) out = out.slice(0, -1);
  else if (out.endsWith(':')) out += 'null';
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';
  return out;
}

/**
 * The value of a JSON text that may be cut anywhere: the text itself when it is complete, else the repaired text. undefined
 * when nothing reads (an empty text, plain text, or a cut in the middle of a key).
 */
export function parsePartialJson(text: string): unknown {
  const t = text.trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch { /* cut or broken: try the repaired text */ }
  try {
    return JSON.parse(repairJson(t));
  } catch {
    return undefined;
  }
}

/** The reply's fields from a parsed value. Anything of the wrong type is dropped to its empty value, never thrown. */
export function readReplyValue(value: unknown): ReplyFields {
  const o = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const rawSegments: unknown[] = Array.isArray(o.segments) ? o.segments : [];
  const segments = rawSegments.map((s): ReplySegment => {
    const x = s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
    const lang = x.lang === 'en' || x.lang === 'zh' ? x.lang : undefined;
    return { lang, text: typeof x.text === 'string' ? x.text : '', gloss: typeof x.gloss === 'string' ? x.gloss : '' };
  });
  const tone = typeof o.tone === 'string' && (CHAT_TONES as readonly string[]).includes(o.tone) ? (o.tone as ChatTone) : undefined;
  return { segments, tip: typeof o.tip === 'string' ? o.tip : '', tone };
}

/** The segments that can be kept: a language, and some text. */
export function toSegments(f: ReplyFields): ChatSegment[] {
  const out: ChatSegment[] = [];
  for (const s of f.segments) {
    if (s.lang && s.text.trim()) out.push({ lang: s.lang, text: s.text, gloss: s.gloss });
  }
  return out;
}

/**
 * The reply as it is shown: each segment's text, and an English segment's gloss in full-width brackets right after it
 * (only when the gloss has come). Segments are joined with one space (English sentences need it).
 */
export function displayOf(segments: ReplySegment[]): string {
  return segments.map((s) => (s.lang !== 'zh' && s.text && s.gloss ? `${s.text}（${s.gloss}）` : s.text)).filter(Boolean).join(' ');
}

/** The canonical JSON of a reply: fixed key order (segments, tip, tone; lang, text, gloss), no spaces. Stored and sent back as is. */
export function canonicalReplyJson(r: ChatReplyJson): string {
  return JSON.stringify({
    segments: r.segments.map((s) => ({ lang: s.lang, text: s.text, gloss: s.gloss })),
    tip: r.tip,
    tone: r.tone,
  });
}

/** True when the text is a reply in the JSON form (a stored or sent reply, see canonicalReplyJson). */
export function isReplyJson(text: string): boolean {
  if (!text.startsWith('{')) return false;
  try {
    const j = JSON.parse(text) as unknown;
    return !!j && typeof j === 'object' && Array.isArray((j as { segments?: unknown }).segments);
  } catch {
    return false;
  }
}

/** Two consecutive replies of hers as one: their segments in order, no tip, the later tone (or the earlier one when the later has none). */
export function mergeReplyJson(a: string, b: string): string {
  const x = readReplyValue(JSON.parse(a));
  const y = readReplyValue(JSON.parse(b));
  return canonicalReplyJson({ segments: [...toSegments(x), ...toSegments(y)], tip: '', tone: y.tone ?? x.tone });
}

/**
 * A stored reply cut to `max` characters for the request: the oldest segments go first (cutting the text itself would break
 * the JSON). Deterministic, so the same stored reply always gives the same request text.
 */
export function fitReplyJson(text: string, max: number): string {
  const r = readReplyValue(JSON.parse(text));
  let segs = toSegments(r);
  const build = (s: typeof segs) => canonicalReplyJson({ segments: s, tip: '', tone: r.tone });
  let out = build(segs);
  // the oldest segments go first (lengths are code points, as the server counts them)
  while (codePointLength(out) > max && segs.length > 1) {
    segs = segs.slice(1);
    out = build(segs);
  }
  // one segment still too long: its longer field is cut from the end (by code points), so the JSON stays valid
  while (codePointLength(out) > max && segs.length === 1) {
    const s = segs[0];
    const field = codePointLength(s.text) >= codePointLength(s.gloss) ? 'text' : 'gloss';
    const cps = [...s[field]];
    if (cps.length === 0) break;
    const over = codePointLength(out) - max;
    segs = [{ ...s, [field]: cps.slice(0, Math.max(0, cps.length - over)).join('') }];
    out = build(segs);
  }
  return out;
}

/** the length of a string in code points (a surrogate pair counts once), the way the server counts a message */
export function codePointLength(s: string): number {
  return [...s].length;
}
