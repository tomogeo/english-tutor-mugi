// Tap-to-replay: the text she says again when one of her lines is tapped
// Pure: no DOM, no speech. Tips (小提醒) and the user's own lines are never spoken, so they give null.

export type ReplayLine = { from: 'me' | 'her'; text: string; tip?: boolean };

/** the text to speak again for a tapped line, or null when it must not be spoken (tip, the user's line, nothing left) */
export function replayText(line: ReplayLine): string | null {
  if (line.from !== 'her' || line.tip) return null;
  const t = line.text.trim();
  return t ? t : null;
}
