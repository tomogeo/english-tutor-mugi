/**
 * The text of a dictation: the text the input had when dictation started (or after the last final text) followed by the
 * recognised text. A single space goes between two Latin words or digits; CJK text is joined without a space.
 */
export function joinDictation(base: string, add: string): string {
  const a = add.trim();
  if (!a) return base;
  if (!base) return a;
  const spaced = /[A-Za-z0-9]$/.test(base) && /^[A-Za-z0-9]/.test(a);
  return spaced ? `${base} ${a}` : `${base}${a}`;
}
