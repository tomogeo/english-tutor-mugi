// Dictation into a one-line chat input: after each recognised update the field shows the END of the text (caret at the
// end, scrolled fully right). Typing and caret moves by hand are left alone. No focus() call: a field that is not focused
// only scrolls (iOS Safari would otherwise pull the keyboard up). Shared by 英語家教.
import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Call the returned function with each value dictation writes into the input (just before setting it). */
export function useDictationScroll(inputRef: RefObject<HTMLInputElement | null>, input: string): (value: string) => void {
  const dictValue = useRef<string | null>(null); // the value the last dictation update put in the input (null once shown)
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || dictValue.current === null || dictValue.current !== input) return;
    dictValue.current = null;
    if (document.activeElement === el) {
      try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* not a text field: nothing to move */ }
    }
    el.scrollLeft = el.scrollWidth;
  }, [inputRef, input]);
  return (value: string) => { dictValue.current = value; };
}
