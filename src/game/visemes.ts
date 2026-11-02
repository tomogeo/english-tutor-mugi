// Mouth shapes for the 英語家教 lip-sync. Pure (no imports): a clip may carry a mouth timeline in the X-TTS-Visemes header;
// the phone plays it against the clip's own clock. The cloud voices send none, so the loudness drives the mouth.

export type VisemeCode = 'a' | 'i' | 'u' | 'e' | 'o' | 'm';
/** one mouth shape: start `t` and length `d` in milliseconds at speed 1 (the synthesized clip's own timing) */
export type Viseme = { t: number; d: number; v: VisemeCode };

export const VISEME_CODES: readonly VisemeCode[] = ['a', 'i', 'u', 'e', 'o', 'm'];

/** the wire format of X-TTS-Visemes: "t:d:v,t:d:v,…" (ms, integers). Unreadable parts are skipped. */
export function encodeVisemes(list: Viseme[]): string {
  return list.map((x) => `${x.t}:${x.d}:${x.v}`).join(',');
}

export function decodeVisemes(header: string | null | undefined): Viseme[] {
  if (!header) return [];
  const out: Viseme[] = [];
  for (const part of header.split(',')) {
    const [t, d, v] = part.split(':');
    const tn = Number(t), dn = Number(d);
    if (!Number.isFinite(tn) || !Number.isFinite(dn) || dn <= 0) continue;
    if (!(VISEME_CODES as readonly string[]).includes(v)) continue;
    out.push({ t: tn, d: dn, v: v as VisemeCode });
  }
  return out;
}

/**
 * The mouth shape at a moment of playback. `elapsedMs` is the time since the clip started playing; the clip was shortened
 * (or stretched) by `speed` (SoundTouch tempo: its length is the original / speed), so the timeline position is
 * elapsed × speed. Null when the moment is outside every shape (before the first, after the last).
 */
export function visemeAt(list: readonly Viseme[], elapsedMs: number, speed: number): VisemeCode | null {
  if (!list.length || !(speed > 0) || !(elapsedMs >= 0)) return null;
  const at = elapsedMs * speed;
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const x = list[mid];
    if (at < x.t) hi = mid - 1;
    else if (at >= x.t + x.d) lo = mid + 1;
    else return x.v;
  }
  return null;
}

/** the index of the shape at a moment (same mapping as visemeAt), -1 when none: a shape's position picks its overlay take */
export function visemeIndexAt(list: readonly Viseme[], elapsedMs: number, speed: number): number {
  if (!list.length || !(speed > 0) || !(elapsedMs >= 0)) return -1;
  const at = elapsedMs * speed;
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const x = list[mid];
    if (at < x.t) hi = mid - 1;
    else if (at >= x.t + x.d) lo = mid + 1;
    else return mid;
  }
  return -1;
}
