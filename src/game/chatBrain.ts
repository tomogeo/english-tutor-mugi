// Chat brain interface: a pluggable "brain" turns the conversation into her reply. The only brain is the Claude brain
// (game/claudeBrain.ts); replyWithFallback is kept so another brain can be chained in front of it later.
import type { ChatLine, Tone } from './chatTypes';
import type { ChatContext, ChatModeId, ChatRoleId } from './claudeProtocol';
import { claudeBrain } from './claudeBrain';

/** `tone`: how she says it, read from her meta tag. */
export type BrainReply = { text: string; tone?: Tone };

/** What a brain can do: streaming (deltas while it writes), teaching (英語老師 mode), and whether it needs the dev server. */
export type BrainCapabilities = { streaming: boolean; teacher: boolean; needsServer: boolean };

/** One turn's request. `situation` is what the Claude request carries with the turn (the time of day). */
export type BrainRequest = {
  history: ChatLine[];
  situation: ChatContext;
  mode: ChatModeId;
  role: ChatRoleId;
  /** the visible reply so far, while a streaming brain writes it */
  onDelta?: (visible: string) => void;
  signal?: AbortSignal;
};

/** A reply with the extras only the Claude brain fills (spoken, segments, tip …). */
export type BrainReplyFull = BrainReply & {
  /** what is voiced (teacher mode: the English only); undefined = the whole text */
  spoken?: string;
  segments?: { text: string; lang: 'zh' | 'en' }[];
  /** 小提醒 (teacher mode): its own line, never voiced */
  tip?: string;
  tipEn?: string[];
  tipRaw?: string;
  tipRewrite?: boolean;
  /** her reply as it is stored and sent back to Claude (the reply JSON, see game/replyJson.ts) */
  sent?: string;
};

export interface ChatBrain {
  id: string;
  label: string;
  capabilities: BrainCapabilities;
  /** can answer right now (Claude: the PC has a key) */
  available(): Promise<boolean> | boolean;
  reply(req: BrainRequest): Promise<BrainReplyFull>;
}

/** The brains to try, in order. Today that is only the Claude brain. */
export function fallbackChain(): ChatBrain[] {
  return [claudeBrain];
}

export type FallbackOptions = {
  /** told about each failing brain before the next one is tried; awaited, so the caller can show the error for a moment */
  onError?: (brain: ChatBrain, message: string) => void | Promise<void>;
  /** skip brains that cannot teach. Default: on in teacher mode. */
  teacherOnly?: boolean;
};

/**
 * Asks the brains in order and returns the first reply. A brain is skipped when it is not available, or (teacherOnly) when
 * it cannot teach. A failing brain is reported through onError and the next one is tried. When none answers, the last
 * failure is thrown, so the caller gets the error to show.
 */
export async function replyWithFallback(
  chain: ChatBrain[],
  req: BrainRequest,
  opts: FallbackOptions = {},
): Promise<{ brain: ChatBrain; reply: BrainReplyFull }> {
  const teacherOnly = opts.teacherOnly ?? req.mode === 'teacher';
  let lastError: unknown = null;
  for (const brain of chain) {
    if (teacherOnly && !brain.capabilities.teacher) continue;
    if (!(await brain.available())) continue;
    try {
      return { brain, reply: await brain.reply(req) };
    } catch (e) {
      lastError = e;
      await opts.onError?.(brain, e instanceof Error ? e.message : '未知錯誤');
    }
  }
  throw lastError ?? new Error('沒有可用的對話引擎');
}
