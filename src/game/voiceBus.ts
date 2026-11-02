import type { VisemeCode } from './visemes';

/** the mouth shape now (v) and its position in the line's timeline (i: alternates the overlay takes) */
export type VisemeCue = { v: VisemeCode; i: number };

// Shared contract between the audio system (producer) and lip-sync (consumer), so both can be built independently.
// The audio side registers the currently playing voice line; lip-sync polls the level every frame.

export type VoiceSource = {
  /** 0..1 loudness of the current voice line (RMS-ish), 0 when silent. */
  level(): number;
  /** Whether a voice line is currently playing. */
  playing(): boolean;
  /** the mouth shape at this moment, when the line carries a timeline; absent or null: use the loudness */
  visemeAt?(): VisemeCue | null;
};

let source: VoiceSource | null = null;
const listeners = new Set<(playing: boolean) => void>();

/** Audio system: call with a source when a voice line starts, `null` when it ends. */
export function setVoiceSource(s: VoiceSource | null) {
  source = s;
  for (const l of listeners) l(!!s);
}

/** Lip-sync: current voice loudness (0 when nothing is playing). */
export const voiceLevel = () => (source && source.playing() ? source.level() : 0);
export const voicePlaying = () => !!source && source.playing();
/** Lip-sync: the mouth shape from the timeline of the current line, null when it has none or nothing is playing. */
export const voiceViseme = (): VisemeCue | null => (source && source.playing() && source.visemeAt ? source.visemeAt() : null);

export function onVoiceChange(l: (playing: boolean) => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
