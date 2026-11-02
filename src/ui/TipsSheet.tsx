// 小提醒筆記本: the tips she gave in 英語老師 mode, each with the English it named. The player can hear it again (示範),
// say it (練習: the mic, judged by game/tipsJudge) or type it, until it is right; right ones move to 已學會.
import { useEffect, useRef, useState } from 'react';
import { loadTips, onTips, removeTip, updateTip, type TipEntry } from '../game/tipsBook';
import { judgeSaid } from '../game/tipsJudge';
import { aiServicesOf, loadTutor } from '../game/tutor';
import { speakReply, stopSpeaking } from '../game/tts';
import { speechNoteText, useSpeechInput } from './useSpeechInput';
import { IconClose } from './icons';

type Tab = 'practice' | 'learned';
type Verdict = { ok: boolean; feedback: string };

/** how long a correct answer stays on its card before it moves to 已學會 */
const MASTER_DELAY_MS = 1200;

export function TipsSheet(props: { onClose: () => void; theme?: 'dark' }) {
  const [tips, setTips] = useState<TipEntry[]>(loadTips);
  const [tab, setTab] = useState<Tab>('practice');
  const [sel, setSel] = useState<Record<string, number>>({}); // which target of a card is chosen (default first)
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [practice, setPractice] = useState<{ id: string; target: string } | null>(null); // the card the mic is for
  const [live, setLive] = useState(''); // what the mic hears so far
  const [note, setNote] = useState('');
  const practiceRef = useRef(practice);
  practiceRef.current = practice;
  const timers = useRef<number[]>([]);

  useEffect(() => onTips(() => setTips(loadTips())), []);
  useEffect(() => () => { timers.current.forEach((t) => clearTimeout(t)); }, []);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  /** judge what the player said for one card and record the attempt */
  const check = async (id: string, target: string, said: string) => {
    setBusy((b) => ({ ...b, [id]: true }));
    const cfg = loadTutor();
    const r = await judgeSaid(target, said, cfg.helperModel, aiServicesOf(cfg));
    setBusy((b) => ({ ...b, [id]: false }));
    setVerdicts((v) => ({ ...v, [id]: { ok: r.ok, feedback: r.feedback } }));
    const cur = loadTips().find((x) => x.id === id);
    if (!cur) return; // removed while judging
    updateTip(id, { tries: cur.tries + 1, lastResult: r.ok ? 'ok' : 'ng' });
    if (r.ok) later(() => updateTip(id, { mastered: true }), MASTER_DELAY_MS);
  };

  const mic = useSpeechInput({
    onStart: () => setNote(''),
    onPartial: (t) => setLive(t),
    onFinal: (t) => {
      setLive('');
      const p = practiceRef.current;
      setPractice(null);
      if (p) void check(p.id, p.target, t);
    },
    onEnd: () => { setLive(''); setPractice(null); },
    onError: (code) => { setNote(speechNoteText(code)); setPractice(null); },
  }, { lang: 'en-US' });

  const startPractice = (id: string, target: string) => {
    if (mic.listening) { mic.stop(); return; } // tapping again while listening stops it
    stopSpeaking(); // her voice must not talk over the player
    setVerdicts((v) => { const n = { ...v }; delete n[id]; return n; });
    setNote('');
    setPractice({ id, target });
    mic.start();
  };

  const demo = (target: string) => {
    if (mic.listening) mic.stop();
    speakReply(target);
  };

  const learned = tips.filter((t) => t.mastered);
  const practising = tips.filter((t) => !t.mastered);
  const list = tab === 'practice' ? practising : learned;

  const card = (e: TipEntry) => {
    const idx = Math.min(sel[e.id] ?? 0, Math.max(0, e.targets.length - 1));
    const target = e.targets[idx];
    const v = verdicts[e.id];
    const listeningHere = practice?.id === e.id;
    return (
      <li key={e.id} className={`tip-card${e.mastered ? ' done' : ''}`}>
        <p className="tip-text">{e.text}</p>
        {e.targets.length > 0 && (
          <div className="tip-targets" role="group" aria-label="練習的句子">
            {e.targets.map((t, i) => (
              <button key={`${i}-${t}`} type="button" className={i === idx ? 'tip-target on' : 'tip-target'} aria-pressed={i === idx}
                onClick={() => setSel((s) => ({ ...s, [e.id]: i }))}>{t}</button>
            ))}
          </div>
        )}
        {e.said && <small className="tip-said">你原本說：{e.said}</small>}
        {target !== undefined && (
          <>
            <div className="tip-actions">
              <button type="button" className="as-small" onClick={() => demo(target)}>示範</button>
              <button type="button" className={listeningHere ? 'as-small on' : 'as-small'} aria-pressed={listeningHere}
                aria-disabled={!mic.supported || undefined} disabled={busy[e.id]} onClick={() => startPractice(e.id, target)}>
                {listeningHere ? '聆聽中…（點一下停止）' : '練習'}
              </button>
            </div>
            {listeningHere && live && <div className="tip-live">{live}</div>}
            <form className="tip-typed" onSubmit={(ev) => {
              ev.preventDefault();
              const said = (typed[e.id] ?? '').trim();
              if (!said) return;
              setTyped((t) => ({ ...t, [e.id]: '' }));
              void check(e.id, target, said);
            }}>
              <input value={typed[e.id] ?? ''} placeholder="或用打字輸入" aria-label="打字練習"
                onChange={(ev) => setTyped((t) => ({ ...t, [e.id]: ev.target.value }))} />
              <button type="submit" className="as-small" disabled={!(typed[e.id] ?? '').trim() || busy[e.id]}>送出</button>
            </form>
          </>
        )}
        {busy[e.id] && <div className="tip-verdict">判斷中…</div>}
        {v && !busy[e.id] && (
          <div className={v.ok ? 'tip-verdict ok' : 'tip-verdict ng'} role="status">
            <b>{v.ok ? '✓ 正確！' : '✗ 還不對'}</b> {v.feedback}
            {!v.ok && target !== undefined && (
              <button type="button" className="as-small" onClick={() => startPractice(e.id, target)}>再試一次</button>
            )}
          </div>
        )}
        <div className="tip-foot">
          <span>{e.tries > 0 ? `練習 ${e.tries} 次` : '還沒練習'}</span>
          {e.mastered && <button type="button" className="as-small" onClick={() => updateTip(e.id, { mastered: false, lastResult: undefined })}>再練一次</button>}
          <button type="button" className="as-small danger" onClick={() => removeTip(e.id)}>刪除</button>
        </div>
      </li>
    );
  };

  return (
    <div className={props.theme === 'dark' ? 'sheet-backdrop sheet-dark' : 'sheet-backdrop'} onClick={props.onClose}>
      <section className="sheet as-tips" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label="小提醒">
        <div className="sheet-head">
          <strong>小提醒</strong>
          <button className="sheet-close" onClick={props.onClose} aria-label="關閉"><IconClose /></button>
        </div>
        <div className="tabs tip-tabs" role="tablist" aria-label="小提醒分類">
          <button type="button" role="tab" aria-selected={tab === 'practice'} className={tab === 'practice' ? 'on' : ''} onClick={() => setTab('practice')}>
            練習中{practising.length > 0 ? ` ${practising.length}` : ''}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'learned'} className={tab === 'learned' ? 'on' : ''} onClick={() => setTab('learned')}>
            已學會{learned.length > 0 ? ` ${learned.length}` : ''}
          </button>
        </div>
        {note && <div className="as-mic-note" role="status">{note}</div>}
        <div className="as-settings-body">
          {list.length === 0 && (
            <p className="tip-empty">{tab === 'practice' ? '還沒有要練習的小提醒。之後她在英語老師模式裡給的提醒會收在這裡。' : '還沒有學會的句子。'}</p>
          )}
          <ul className="tip-list">{list.map(card)}</ul>
        </div>
      </section>
    </div>
  );
}
