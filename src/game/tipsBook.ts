// 小提醒筆記本: every 小提醒 (teacher-mode tip) is saved here with the English targets it named, so the player can practise
// saying them until they are right. Stored in localStorage; every access is guarded, so with no storage it still works
// (the book just lives in memory for the session).


export type TipEntry = {
  id: string;
  /** the tip display text (Chinese explanation) */
  text: string;
  /** the English targets written inside the tip */
  targets: string[];
  /** what the player said that triggered the tip */
  said?: string;
  /** the character (role) who gave the tip */
  role: string;
  /** when it was saved (ms since epoch) */
  at: number;
  /** how many practice attempts were judged */
  tries: number;
  mastered: boolean;
  lastResult?: 'ok' | 'ng';
};

export const TIPS_KEY = 'mugien.tips.v1';
export const TIPS_MAX = 300;

type Listener = (tips: TipEntry[]) => void;

/** a leading label the tip text must not carry (the bubble already says 小提醒): 小提醒： / 提醒: / Tip： … */
const TIP_LABEL = /^\s*(小提醒|提醒|Tip)\s*[：:]\s*/i;
/** the tip text without a leading label */
export function stripTipLabel(s: string): string {
  return s.replace(TIP_LABEL, '');
}

const listeners = new Set<Listener>();
/** in-memory copy: the source of truth whenever storage is missing or broken */
let memory: TipEntry[] | null = null;

function readStorage(): TipEntry[] {
  try {
    const raw = localStorage.getItem(TIPS_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    return Array.isArray(j) ? (j as TipEntry[]).filter(isEntry) : [];
  } catch {
    return [];
  }
}

function isEntry(v: unknown): v is TipEntry {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.text === 'string' && Array.isArray(o.targets) && typeof o.role === 'string'
    && typeof o.at === 'number' && typeof o.tries === 'number' && typeof o.mastered === 'boolean';
}

function current(): TipEntry[] {
  if (!memory) memory = readStorage();
  return memory;
}

function save(list: TipEntry[]) {
  memory = list;
  try { localStorage.setItem(TIPS_KEY, JSON.stringify(list)); } catch { /* no storage: memory only */ }
  for (const l of listeners) l(list);
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Keep at most TIPS_MAX entries (the list is newest first): drop the oldest mastered first, then the oldest of the rest. */
function capped(list: TipEntry[]): TipEntry[] {
  let out = list;
  while (out.length > TIPS_MAX) {
    let drop = out.length - 1;
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].mastered) { drop = i; break; }
    }
    out = out.filter((_, i) => i !== drop);
  }
  return out;
}

export function loadTips(): TipEntry[] {
  return current().slice();
}

/** Save a tip. An exact duplicate (same text and targets) that is still being practised is not saved again. */
export function addTip(e: Omit<TipEntry, 'id' | 'at' | 'tries' | 'mastered'>): TipEntry | null {
  const text = stripTipLabel(e.text);
  const list = current();
  const dup = list.find((x) => !x.mastered && x.text === text && sameList(x.targets, e.targets));
  if (dup) return null;
  const entry: TipEntry = { ...e, text, id: newId(), at: Date.now(), tries: 0, mastered: false };
  save(capped([entry, ...list]));
  return entry;
}

export function updateTip(id: string, patch: Partial<Omit<TipEntry, 'id'>>) {
  const list = current();
  if (!list.some((x) => x.id === id)) return;
  save(list.map((x) => (x.id === id ? { ...x, ...patch, id: x.id } : x)));
}

export function removeTip(id: string) {
  const list = current();
  if (!list.some((x) => x.id === id)) return;
  save(list.filter((x) => x.id !== id));
}

/** Subscribe to changes; returns the unsubscribe function. */
export function onTips(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function unmasteredCount(): number {
  return current().filter((x) => !x.mastered).length;
}

/** Test helper: forget the in-memory copy so the next call reads storage again. */
export function resetTipsCacheForTest() {
  memory = null;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Loose comparison key for an English sentence: NFKC, lower case, curly apostrophes made straight, then every space and
 * punctuation mark removed ("I'm fine." and "im fine" compare equal).
 */
export function normalizeEn(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\s\u3000]+/g, '')
    .replace(/[\u3001-\u3003\u300c-\u300f\u2026\uff08\uff09\u3008-\u3011\uff01\uff1f]/g, '')
    .replace(/[!-/:-@[-`{-~]/g, '');
}

export function sameEn(a: string, b: string): boolean {
  return normalizeEn(a) === normalizeEn(b);
}
