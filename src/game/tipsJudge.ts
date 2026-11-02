// 小提醒 practice: is what the player said the same sentence as the target? The exact (loose) match is decided on the
// phone with no network; anything else goes to the dev server's /api/chat/judge (Claude). When Claude cannot be
// reached the answer is "not the same", never a guess that it is right.
import { apiFetch } from './apiFetch';
import { sameEn } from './tipsBook';
import type { AiServices } from './tutor';

export type JudgeResult = { ok: boolean; feedback: string; by: 'local' | 'claude' | 'none' };

const UNREACHABLE = '和目標句不一樣（無法連線 Claude 做進一步判斷）';

/** `model`: the 小提醒 model (the settings' 速查與小提醒 model); absent, the server's default */
export async function judgeSaid(target: string, said: string, model?: string, services?: AiServices): Promise<JudgeResult> {
  if (sameEn(target, said)) return { ok: true, feedback: '完全正確！', by: 'local' };
  let res: Response;
  try {
    res = await apiFetch('/api/chat/judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, said, ...(model ? { model } : {}), ...(services ?? {}) }),
    });
  } catch {
    return { ok: false, feedback: UNREACHABLE, by: 'none' };
  }
  if (!res.ok) return { ok: false, feedback: UNREACHABLE, by: 'none' };
  try {
    const j = (await res.json()) as { ok?: unknown; feedback?: unknown };
    if (typeof j.ok !== 'boolean') return { ok: false, feedback: UNREACHABLE, by: 'none' };
    const feedback = typeof j.feedback === 'string' && j.feedback.trim() ? j.feedback.trim() : (j.ok ? '完全正確！' : '和目標句不一樣');
    return { ok: j.ok, feedback, by: 'claude' };
  } catch {
    return { ok: false, feedback: UNREACHABLE, by: 'none' };
  }
}
