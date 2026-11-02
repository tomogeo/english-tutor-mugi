import { apiFetch } from './apiFetch';
// 用量 (the settings sheet's usage section): the shapes GET /api/usage returns (server/usage.ts), the fetch that tolerates an
// old dev server (404 → 「伺服器重開後才會開始統計」), and the pure formatting helpers.
// The types are copied, not imported: the app build must not pull in the Node-side server module.

export type TtsCounter = { requests: number; failures: number; chars: number; cacheHits: number; fallbacks?: number };
export type ClaudeCounter = {
  requests: number; errors: number; inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number;
  costUsd: number; unpriced: number;
};
export type MonthUsage = {
  tts: { google: Record<string, TtsCounter>; azure: Record<string, TtsCounter> };
  claude: Record<string, ClaudeCounter>;
};
export type UsageData = {
  months: Record<string, MonthUsage>;
  current: string;
  freeTier: { google: Record<string, number>; azure: Record<string, number> };
  /** the speech disk cache (absent on a dev server that predates it) */
  ttsCache?: { files: number; bytes: number };
};

/** 「語音快取：N 句・X MB（重複的句子不再計費）」 */
export function ttsCacheLine(c: { files: number; bytes: number }): string {
  return `語音快取：${fmtInt(c.files)} 句・${(c.bytes / 1024 / 1024).toFixed(1)} MB（重複的句子不再計費）`;
}

/** POST /api/tts/cache/clear: true when the dev server emptied the speech cache */
export async function clearTtsCache(): Promise<boolean> {
  try {
    const r = await apiFetch('/api/tts/cache/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}

/** an estimate only: a fixed rate constant (the sheet labels every converted figure 估算) */
export const USD_TO_TWD = 32;

/** the Google tiers in display order, with the names the sheet uses */
export const GOOGLE_TIER_LABEL: Record<string, string> = {
  standard: 'Standard 標準',
  wavenet: 'WaveNet',
  neural2: 'Neural2',
};

export const usdToTwd = (usd: number): number => usd * USD_TO_TWD;

/** 12345 → "12,345" */
export const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** a share of an allowance as "0.3%"; a tiny non-zero share reads "<0.1%"; no allowance → "" */
export function fmtPct(used: number, total: number): string {
  if (!(total > 0)) return '';
  const p = (used / total) * 100;
  if (p > 0 && p < 0.05) return '<0.1%';
  return `${p.toFixed(1)}%`;
}

/** the progress bar width, 0..100 */
export function barPct(used: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

/** USD for the sheet: a cent-level figure below a dollar keeps 4 decimals so a small month is not "$0.00" */
export function fmtUsd(usd: number): string {
  return usd >= 1 ? `US$${usd.toFixed(2)}` : `US$${usd.toFixed(4)}`;
}

export function fmtTwd(usd: number): string {
  return `NT$${Math.round(usdToTwd(usd)).toLocaleString('en-US')}`;
}

/** a month key 'YYYY-MM' as 2026年10月 */
export function fmtMonth(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  return m ? `${m[1]}年${Number(m[2])}月` : key;
}

export type UsageResult = { kind: 'ok'; data: UsageData } | { kind: 'missing' } | { kind: 'error' };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
  * GET /api/usage. 404 or any non-OK answer (or one that is not the usage JSON, e.g. Vite's HTML fallback) means the running dev server
 * predates the usage route: 'missing', shown as 「伺服器重開後才會開始統計」. A network failure is 'error'.
 */
export async function fetchUsage(): Promise<UsageResult> {
  try {
    const r = await apiFetch('/api/usage', { cache: 'no-store' });
    // 404 from a dev server that predates the route (or any other non-OK answer from it): not available yet
    if (!r.ok) return { kind: 'missing' };
    let j: unknown;
    try { j = JSON.parse(await r.text()); } catch { return { kind: 'missing' }; }
    if (!isObj(j) || !isObj(j.months) || typeof j.current !== 'string') return { kind: 'missing' };
    return { kind: 'ok', data: j as unknown as UsageData };
  } catch {
    return { kind: 'error' };
  }
}

/** the months to offer, newest first, the current month at the front when stored */
export function monthList(d: UsageData): string[] {
  return Object.keys(d.months).sort().reverse();
}

const EMPTY_MONTH: MonthUsage = { tts: { google: {}, azure: {} }, claude: {} };
export const monthOf = (d: UsageData, key: string): MonthUsage => d.months[key] ?? EMPTY_MONTH;

/** total Claude cost of a month in USD */
export function claudeTotalUsd(m: MonthUsage): number {
  return Object.values(m.claude).reduce((s, c) => s + c.costUsd, 0);
}

// ---------- the free-tier fallback (server/tts.ts planTts; the same rule, shown here) ----------

/** a free allowance counts as used up at this share: past it, the speech moves to the next option */
export const FALLBACK_AT = 0.9;

/** the Google tier chain a request falls back along (server/usage.ts GOOGLE_FALLBACK_CHAIN) */
export const GOOGLE_FALLBACK_CHAIN: Record<string, string[]> = {
  neural2: ['wavenet', 'standard'],
  wavenet: ['standard'],
  standard: [],
};

/** short tier names for notices */
const TIER_SHORT: Record<string, string> = { standard: 'Standard', wavenet: 'WaveNet', neural2: 'Neural2', neural: 'Azure', 'chirp3-hd': 'Chirp3-HD' };
export const tierShort = (t: string): string => TIER_SHORT[t] ?? t;

/** the used share of a tier has reached the fallback share (a tier without an allowance never has) */
export function pastFallbackAt(d: UsageData, month: string, engine: 'google' | 'azure', tier: string): boolean {
  const free = d.freeTier[engine][tier];
  if (free === undefined) return false;
  return (monthOf(d, month).tts[engine][tier]?.chars ?? 0) >= free * FALLBACK_AT;
}

/**
 * Where a Google tier's speech goes this month, as the sheet words it: the next tier of the chain still under the share,
 * then Azure (when its key is set and it is under the share), then the browser.
 */
export function fallbackTarget(d: UsageData, month: string, tier: string, azureConfigured: boolean): string {
  for (const t of GOOGLE_FALLBACK_CHAIN[tier] ?? []) {
    if (!pastFallbackAt(d, month, 'google', t)) return tierShort(t);
  }
  if (azureConfigured && !pastFallbackAt(d, month, 'azure', 'neural')) return 'Azure';
  return '瀏覽器內建語音';
}

/** the month key of the clock, 'YYYY-MM' local */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// The one-time notice: shown the first time a fallback happens in a month (remembered in this browser only).
const NOTICE_KEY = 'mugien.usage.notice';
/** true the first time this month (and records it); false afterwards, or when storage is unavailable */
export function firstFallbackThisMonth(month: string): boolean {
  try {
    if (localStorage.getItem(NOTICE_KEY) === month) return false;
    localStorage.setItem(NOTICE_KEY, month);
    return true;
  } catch {
    return false;
  }
}

const fallbackListeners = new Set<(text: string) => void>();
/** subscribes to the one-time fallback notice; returns the unsubscribe */
export function onTtsFallbackNotice(l: (text: string) => void): () => void {
  fallbackListeners.add(l);
  return () => void fallbackListeners.delete(l);
}

/**
 * A sentence was diverted: `requested` is the tier asked for ('neural2'), `usedLabel` what spoke it. Only the first diversion
 * of a month is announced (the sheet's 用量 section always shows the state).
 */
export function reportTtsFallback(requested: string, usedLabel: string, now: Date = new Date()): void {
  const month = currentMonthKey(now);
  if (!firstFallbackThisMonth(month)) return;
  const text = `${tierShort(requested)} 已達 90%，本月改用 ${usedLabel}`;
  fallbackListeners.forEach((l) => l(text));
}
