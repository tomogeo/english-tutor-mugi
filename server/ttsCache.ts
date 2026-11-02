// Persistent disk cache for synthesized speech: the second level under the in-memory LRU (server/tts.ts).
// Files: .tts-cache/<sha256 of the cache key, hex>.mp3 (gitignored). The key (and so the text) is never a file name.
// Lookup: memory → disk (read, promoted to memory, its mtime bumped) → the provider. Store: memory at once, disk in the
// background (temp file + rename, so a reader never sees a half-written file). The total is capped at TTS_CACHE_MAX_BYTES:
// the least recently used files (oldest mtime; every hit bumps it) are removed after writes (debounced) and once at startup.
// Concurrent requests for the same key share one synthesis (fetchOnce).
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const TTS_CACHE_DIR = '.tts-cache';
/** the disk cap: 200 MB of mp3 files */
export const TTS_CACHE_MAX_BYTES = 200 * 1024 * 1024;
/** the in-memory LRU holds this many replies ... */
export const TTS_CACHE_MEM_MAX = 200;
/** ... and at most this many bytes of them (32 MB); a reply bigger than this is kept on disk only */
export const TTS_CACHE_MEM_MAX_BYTES = 32 * 1024 * 1024;
/** a burst of writes is swept once, this long after the last write */
export const TTS_CACHE_SWEEP_DEBOUNCE_MS = 2000;
const FILE_RE = /^[0-9a-f]{64}\.(mp3|wav)$/;
/** the file extension of a cached reply: MP3 from the cloud engines (WAV is still accepted) */
export type TtsAudioExt = 'mp3' | 'wav';

/** the file name of a cache key: sha256 (hex) + the extension. The key holds the text, so the name hides it. */
export function ttsCacheFileName(key: string, ext: TtsAudioExt = 'mp3'): string {
  return `${createHash('sha256').update(key, 'utf8').digest('hex')}.${ext}`;
}

/** a plausible WAV payload: a RIFF container of type WAVE  */
export function looksLikeWav(buf: Buffer): boolean {
  return buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE';
}

/** the payload check of a file extension */
export function looksLikeAudio(buf: Buffer, ext: TtsAudioExt): boolean {
  return ext === 'wav' ? looksLikeWav(buf) : looksLikeMp3(buf);
}

/** a plausible MP3 payload: an ID3 tag or an MPEG audio frame sync (Azure and Google both return MP3) */
export function looksLikeMp3(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true; // 'ID3'
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
}

export type TtsCacheOptions = {
  dir: string;
  maxBytes?: number;
  memMax?: number;
  memMaxBytes?: number;
  sweepDebounceMs?: number;
  /** the clock for the LRU mtimes (ms); tests inject one */
  now?: () => number;
};

type Entry = { bytes: number; mtime: number };

export class TtsCache {
  readonly dir: string;
  private readonly maxBytes: number;
  private readonly memMax: number;
  private readonly memMaxBytes: number;
  private readonly sweepDebounceMs: number;
  private readonly now: () => number;
  /** key → mp3 bytes; Map keeps insertion order, a hit is re-inserted at the end */
  private readonly mem = new Map<string, Buffer>();
  /** the bytes held by mem (kept under memMaxBytes) */
  private memBytes = 0;
  /** file name → size and LRU mtime, for every complete file on disk (rebuilt from the directory at startup) */
  private readonly index = new Map<string, Entry>();
  private totalBytes = 0;
  /** key → the synthesis running now (a second request for the same key waits for it) */
  private readonly inflight = new Map<string, Promise<Buffer>>();
  private readonly writes = new Set<Promise<void>>();
  /** sweeps still removing files (the startup one runs in the background) */
  private readonly sweeps = new Set<Promise<number>>();
  private sweepTimer: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;

  constructor(opts: TtsCacheOptions) {
    this.dir = opts.dir;
    this.maxBytes = opts.maxBytes ?? TTS_CACHE_MAX_BYTES;
    this.memMax = opts.memMax ?? TTS_CACHE_MEM_MAX;
    this.memMaxBytes = opts.memMaxBytes ?? TTS_CACHE_MEM_MAX_BYTES;
    this.sweepDebounceMs = opts.sweepDebounceMs ?? TTS_CACHE_SWEEP_DEBOUNCE_MS;
    this.now = opts.now ?? (() => Date.now());
    this.scan();
    // the startup sweep: a directory left over the cap (or a smaller cap now) is trimmed once
    void this.sweep();
  }

  /** rebuild the index from the directory; leftover temp files of an interrupted write are removed */
  private scan() {
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch (e) {
      console.warn('[tts-cache] cannot create', this.dir, e instanceof Error ? e.message : e);
      return;
    }
    for (const name of readdirSync(this.dir)) {
      const p = join(this.dir, name);
      if (name.endsWith('.tmp')) {
        // a leftover temp file of an interrupted write
        try { unlinkSync(p); } catch { /* gone already */ }
        continue;
      }
      if (!FILE_RE.test(name)) continue;
      try {
        const st = statSync(p);
        if (!st.isFile()) continue;
        this.index.set(name, { bytes: st.size, mtime: st.mtimeMs });
        this.totalBytes += st.size;
      } catch { /* vanished while scanning */ }
    }
  }

  /** files and bytes on disk (GET /api/usage shows them) */
  stats(): { files: number; bytes: number } {
    return { files: this.index.size, bytes: this.totalBytes };
  }

  private memGet(key: string): Buffer | undefined {
    const v = this.mem.get(key);
    if (v) {
      this.mem.delete(key);
      this.mem.set(key, v);
    }
    return v;
  }

  /** the memory copies: at most memMax replies and memMaxBytes bytes; the least recently used go first */
  private memPut(key: string, v: Buffer) {
    const old = this.mem.get(key);
    if (old) {
      this.memBytes -= old.length;
      this.mem.delete(key);
    }
    if (v.length > this.memMaxBytes) return; // too big to hold in memory: the disk copy serves it
    this.mem.set(key, v);
    this.memBytes += v.length;
    while (this.mem.size > this.memMax || this.memBytes > this.memMaxBytes) {
      const oldest = this.mem.keys().next().value;
      if (oldest === undefined) break;
      this.memBytes -= this.mem.get(oldest)?.length ?? 0;
      this.mem.delete(oldest);
    }
  }

  /** bytes of replies held in memory right now (at most memMaxBytes) */
  memoryBytes(): number {
    return this.memBytes;
  }

  /** a hit bumps the file's LRU mtime (in the index at once, on disk in the background) */
  private touch(name: string) {
    const e = this.index.get(name);
    if (!e) return;
    const t = this.now();
    e.mtime = t;
    const d = new Date(t);
    utimes(join(this.dir, name), d, d).catch(() => { /* a file being removed */ });
  }

  /** drops a file from the index (the caller removes it from disk) */
  private forget(name: string) {
    const e = this.index.get(name);
    if (!e) return;
    this.index.delete(name);
    this.totalBytes -= e.bytes;
  }

  /** the cached reply of a key: memory first, then disk (promoted to memory). A file of the wrong kind is removed and misses. */
  async lookup(key: string, ext: TtsAudioExt = 'mp3'): Promise<Buffer | undefined> {
    const mem = this.memGet(key);
    if (mem) {
      this.touch(ttsCacheFileName(key, ext));
      return mem;
    }
    const name = ttsCacheFileName(key, ext);
    if (!this.index.has(name)) return undefined;
    let buf: Buffer;
    try {
      buf = await readFile(join(this.dir, name));
    } catch {
      this.forget(name); // removed outside this process
      return undefined;
    }
    if (!looksLikeAudio(buf, ext)) {
      console.warn('[tts-cache] ignoring a damaged file', name);
      this.forget(name);
      // awaited: a fresh write of the same key must not be removed by this late unlink
      await unlink(join(this.dir, name)).catch(() => { /* already gone */ });
      return undefined;
    }
    this.memPut(key, buf);
    this.touch(name);
    return buf;
  }

  /** the memory copy of a key only (no disk); a hit is moved to the newest place and its LRU time bumped, as lookup does */
  peek(key: string, ext: TtsAudioExt = 'mp3'): Buffer | undefined {
    const v = this.memGet(key);
    if (v) this.touch(ttsCacheFileName(key, ext));
    return v;
  }

  /** the answer for a key that is in memory or being synthesized right now, without touching the disk */
  private sharedNow(key: string): Buffer | Promise<Buffer> | undefined {
    return this.memGet(key) ?? this.inflight.get(key);
  }

  /**
   * The cached mp3 for `key`, or one `synth` makes. `hit` is false only for the call that ran `synth`; a call that found the
   * reply in memory or on disk, or waited for a synthesis already running for the same key, gets hit: true (nothing is sent).
   * A failed synthesis is not stored, and its waiting callers get the same error.
   */
  async fetchOnce(key: string, synth: () => Promise<Buffer>, ext: TtsAudioExt = 'mp3'): Promise<{ buf: Buffer; hit: boolean }> {
    const early = this.sharedNow(key);
    if (early) return { buf: await early, hit: true };
    const hit = await this.lookup(key, ext);
    if (hit) return { buf: hit, hit: true };
    // a synthesis may have started (or finished into memory) while the disk was read
    const late = this.sharedNow(key);
    if (late) return { buf: await late, hit: true };
    const running = (async () => {
      const buf = await synth();
      this.store(key, buf, ext); // memory now, disk in the background: the reply is not held up by the write
      return buf;
    })();
    this.inflight.set(key, running);
    try {
      return { buf: await running, hit: false };
    } finally {
      this.inflight.delete(key);
    }
  }

  /** memory at once; the file is written in the background (failures are logged, never thrown) */
  store(key: string, buf: Buffer, ext: TtsAudioExt = 'mp3'): Promise<void> {
    this.memPut(key, buf);
    const name = ttsCacheFileName(key, ext);
    const t = this.now(); // the LRU time is when the reply was made, not when the write finishes
    const p = this.writeFile(name, buf, t).then(
      () => {
        const old = this.index.get(name);
        if (old) this.totalBytes -= old.bytes;
        this.index.set(name, { bytes: buf.length, mtime: t });
        this.totalBytes += buf.length;
        this.scheduleSweep();
      },
      (e: unknown) => {
        console.warn('[tts-cache] write failed:', e instanceof Error ? e.message : e);
      },
    );
    this.writes.add(p);
    void p.then(() => this.writes.delete(p));
    return p;
  }

  /** temp file, LRU mtime, then rename over the name (the fallback for Windows: a file that cannot be replaced is removed first) */
  private async writeFile(name: string, buf: Buffer, t: number): Promise<void> {
    const final = join(this.dir, name);
    const tmp = join(this.dir, `${name}.${process.pid}.${++this.seq}.${randomBytes(4).toString('hex')}.tmp`);
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(tmp, buf);
      const d = new Date(t);
      await utimes(tmp, d, d);
      try {
        await rename(tmp, final);
      } catch {
        await unlink(final).catch(() => { /* not there */ });
        await rename(tmp, final);
      }
    } catch (e) {
      await unlink(tmp).catch(() => { /* no temp file */ });
      throw e;
    }
  }

  /** a trailing debounce: the sweep runs sweepDebounceMs after the last write */
  private scheduleSweep() {
    if (this.sweepTimer) clearTimeout(this.sweepTimer);
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = undefined;
      void this.sweep();
    }, this.sweepDebounceMs);
    this.sweepTimer.unref?.();
  }

  /**
   * Removes the least recently used files until the total is within the cap. The index is updated before the files are
   * removed, so the bookkeeping never counts a file twice. Returns how many files were removed.
   */
  sweep(): Promise<number> {
    const run = this.trim();
    this.sweeps.add(run);
    void run.then(() => this.sweeps.delete(run));
    return run;
  }

  private async trim(): Promise<number> {
    if (this.totalBytes <= this.maxBytes) return 0;
    const order = [...this.index.entries()].sort((a, b) => a[1].mtime - b[1].mtime || (a[0] < b[0] ? -1 : 1));
    const victims: [string, Entry][] = [];
    let total = this.totalBytes;
    for (const [name, e] of order) {
      if (total <= this.maxBytes) break;
      victims.push([name, e]);
      total -= e.bytes;
    }
    for (const [name] of victims) this.forget(name);
    const failed = await Promise.all(victims.map(async ([name, e]) => {
      try {
        await unlink(join(this.dir, name));
        return false;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
        // still on disk (for example locked): keep it counted, so the next sweep tries again
        this.index.set(name, e);
        this.totalBytes += e.bytes;
        return true;
      }
    }));
    const removed = victims.length - failed.filter(Boolean).length;
    if (removed) console.log(`[tts-cache] evicted ${removed} file(s), ${(this.totalBytes / 1024 / 1024).toFixed(1)} MB kept`);
    return removed;
  }

  /** waits for the writes in progress and runs a pending sweep now (tests and shutdown use it) */
  async settle(): Promise<void> {
    await Promise.all([...this.writes]);
    if (this.sweepTimer) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    await this.sweep();
    await Promise.all([...this.sweeps]);
  }

  /** removes every cached file and the memory copies (POST /api/tts/cache/clear) */
  async clear(): Promise<{ files: number; bytes: number }> {
    await Promise.all([...this.writes, ...this.sweeps]);
    this.mem.clear();
    this.memBytes = 0;
    const names = [...this.index.keys()];
    const before = this.stats();
    for (const n of names) this.forget(n);
    await Promise.all(names.map((n) => unlink(join(this.dir, n)).catch(() => { /* already gone */ })));
    return before;
  }
}

const caches = new Map<string, TtsCache>();

/** the one cache for the project root; created (and its directory scanned and trimmed) on first use */
export function getTtsCache(root: string): TtsCache {
  const dir = join(root, TTS_CACHE_DIR);
  let c = caches.get(dir);
  if (!c) {
    c = new TtsCache({ dir });
    caches.set(dir, c);
  }
  return c;
}
