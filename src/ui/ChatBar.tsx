// The chat bar used by 英語家教 (TutorView): the history overlay above it, the voice pill and
// the notes, and the input row (💬/▾, field with ghost text, 日/中, 🗣️, 🎤, 換她開話題, 送出). The screen keeps the logic
// (send, dictation, keyboard, voice and mic handling) and pass it in as props; this file only renders and reports taps.
// Keyboard docking (useIOSKeyboard) and the layout around the bar are the screen's CSS (tutor.css).
import type { ReactNode, RefObject } from 'react';
import { clipCodePoints } from '../game/claudeProtocol';
import { SPEECH_UNSUPPORTED_TEXT } from './useSpeechInput';
import { IconChat, IconChevronDown, IconMic, IconStop, IconTalk } from './icons';
import './ChatBar.css';

export interface ChatBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** the text the field shows while it is empty (the ghost, see ChatBar.css); defaults to the placeholder */
  ghostHint?: string;
  /** the input is not usable (英語家教 without a Claude key) */
  disabled?: boolean;
  /** iOS keyboard hooks (useIOSKeyboard): the view calls keyboard.onFocus / keyboard.onBlur here */
  onFocus?: () => void;
  onBlur?: () => void;
  /** the view sends `value`; called on submit (send button or Enter) */
  onSubmit: () => void;
  /** besides the empty text, the 送出 button is disabled while this is true */
  sendDisabled?: boolean;
  chatOpen: boolean;
  /** 💬 / ▾: asks the view to open (true) or fold (false) the history */
  onToggleChat: (open: boolean) => void;
  /** the history items (<li>s); rendered in the overlay only while chatOpen */
  history?: ReactNode;
  historyRef?: RefObject<HTMLUListElement | null>;
  /** one line each, shown above the input row when truthy */
  notes?: (string | false | null | undefined)[];
  /** the 語音對話 status pill (shown when given) */
  pill?: { phase: string; label: string; onStop: () => void };
  /** the 日 / 中 speech-language toggle (shown when given) */
  stt?: { lang: string; title?: string; onToggle: () => void };
  voice: { active: boolean; disabled?: boolean; onToggle: () => void };
  mic: { listening: boolean; supported: boolean; onToggle: () => void };
  /** 換她開話題 (shown when given) */
  onOpenTopic?: () => void;
  /** the most the field takes, in code points (typing past it is cut); a counter shows within 100 of it */
  maxChars?: number;
}

export function ChatBar(p: ChatBarProps) {
  const { inputRef, value, placeholder, chatOpen, voice, mic } = p;
  const canSend = !!value.trim() && !p.sendDisabled;
  const cap = p.maxChars;
  const count = [...value].length;
  return (
    <div className="chatbar">
      {chatOpen && <ul className="as-history" ref={p.historyRef}>{p.history}</ul>}
      {cap !== undefined && count >= cap - 100 && <div className="as-count" role="status">{count} / {cap} 字</div>}
      {p.pill && (
        <div className="as-voice-pill" role="status" aria-live="polite">
          <span className={`as-voice-dot ${p.pill.phase}`} aria-hidden="true" />
          <span>{p.pill.label}</span>
          <button type="button" className="as-voice-stop" aria-label="停止語音對話" onClick={p.pill.onStop}><IconStop /></button>
        </div>
      )}
      {p.notes?.filter(Boolean).map((n, i) => <div key={i} className="as-mic-note" role="status">{n}</div>)}
      <form className="as-input" onSubmit={(e) => { e.preventDefault(); p.onSubmit(); }}>
        <button type="button" className="as-toggle" aria-label={chatOpen ? '收起對話' : '展開對話'} onClick={() => p.onToggleChat(!chatOpen)}>
          {chatOpen ? <IconChevronDown /> : <IconChat />}
        </button>
        <span className="as-field">
          <input ref={inputRef} value={value} onChange={(e) => p.onChange(cap !== undefined ? clipCodePoints(e.target.value, cap) : e.target.value)}
            onFocus={() => p.onFocus?.()} onBlur={() => p.onBlur?.()}
            placeholder={placeholder} disabled={p.disabled} enterKeyHint="send" aria-label="訊息" />
          {/* stands in for the input while it is lifted out of the way of iOS's focus scroll (useIOSKeyboard) */}
          <span className="as-ghost" aria-hidden="true">{value || p.ghostHint || placeholder}</span>
        </span>
        {p.stt && (
          <button type="button" className="as-stt" aria-label={p.stt.lang === 'en-US' ? '辨識語言：英文，點一下改中文' : '辨識語言：中文，點一下改英文'}
            title={p.stt.title} onClick={p.stt.onToggle}>
            {p.stt.lang === 'en-US' ? '英' : '中'}
          </button>
        )}
        <button type="button" className={voice.active ? 'as-voice on' : 'as-voice'} aria-label={voice.active ? '結束語音對話' : '語音對話'}
          aria-pressed={voice.active} aria-disabled={voice.disabled || undefined} title="語音對話：她會出聲回覆，然後再聽你說"
          onClick={voice.onToggle}><IconTalk /></button>
        <button type="button" className={mic.listening ? 'as-mic on' : 'as-mic'} aria-label={mic.listening ? '停止聆聽' : '語音輸入'}
          aria-pressed={mic.listening} aria-disabled={!mic.supported || undefined} title={mic.supported ? undefined : SPEECH_UNSUPPORTED_TEXT}
          onClick={mic.onToggle}><IconMic /></button>
        {p.onOpenTopic && (
          <button type="button" className="as-topic" aria-label="換她開話題" title="換她開話題" onClick={p.onOpenTopic}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 4h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
              <path d="M21 0.5v5M18.5 3h5" />
            </svg>
          </button>
        )}
        <button type="submit" className="as-send" disabled={!canSend}>送出</button>
      </form>
    </div>
  );
}
