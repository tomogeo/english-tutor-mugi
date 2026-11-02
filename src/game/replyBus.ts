// Shared contract between whatever produces her reply text (the Claude stream) and whatever voices it
// (TTS + lip-sync, voice-conversation loop). Producers emit; consumers subscribe. Keeps the two features decoupled.

export type ReplyEvent =
  | { type: 'start'; id: number }
  /** a chunk of new reply text (streaming); `lang` hints which TTS voice to use for this chunk */
  | { type: 'delta'; id: number; text: string; lang?: 'zh' | 'en' }
  /** the full reply is known; `text` is the complete visible reply */
  | { type: 'done'; id: number; text: string }
  | { type: 'error'; id: number; message: string };

type Listener = (e: ReplyEvent) => void;
const listeners = new Set<Listener>();
let seq = 0;

export const nextReplyId = () => ++seq;

export function emitReply(e: ReplyEvent) {
  for (const l of listeners) l(e);
}

export function onReply(l: Listener) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
