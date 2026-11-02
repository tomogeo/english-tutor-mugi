// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readTranscript, speechCtor, speechErrorText, speechNoteText, useSpeechInput, type SpeechHandlers, type SpeechOptions, type SpeechRecognitionLike, type SpeechResultEvent } from '../useSpeechInput';

// a minimal stand-in for the browser's SpeechRecognition: the test drives the events by hand
class FakeRecognition implements SpeechRecognitionLike {
  static made: FakeRecognition[] = [];
  lang = ''; interimResults = false; continuous = true; maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: ((e: SpeechResultEvent) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0; stopped = 0; aborted = 0;
  constructor() { FakeRecognition.made.push(this); }
  start() { this.started++; }
  stop() { this.stopped++; }
  abort() { this.aborted++; }
  // helpers for the tests
  emit(transcript: string, isFinal: boolean) {
    const result = Object.assign([{ transcript, confidence: 0.9 }], { isFinal, length: 1 });
    this.onresult?.({ results: { length: 1, 0: result } } as never);
  }
}

type Api = ReturnType<typeof useSpeechInput>;
function mount(handlers: SpeechHandlers) {
  const box: { api?: Api } = {};
  const Probe = () => { box.api = useSpeechInput(handlers); return null; };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act(() => root.render(createElement(Probe)));
  return { box, unmount: () => act(() => root.unmount()) };
}

const w = window as unknown as Record<string, unknown>;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  FakeRecognition.made = [];
  w.webkitSpeechRecognition = FakeRecognition;
});
afterEach(() => {
  delete w.webkitSpeechRecognition;
  delete w.SpeechRecognition;
  document.body.innerHTML = '';
});

describe('speechCtor (feature detection)', () => {
  it('no recognition in this browser: null', () => {
    expect(speechCtor({})).toBeNull();
    expect(speechCtor(null)).toBeNull();
  });
  it('webkit-prefixed (iOS Safari) and the standard name are both found; the standard one wins', () => {
    expect(speechCtor({ webkitSpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
    const Std = class extends FakeRecognition {};
    expect(speechCtor({ SpeechRecognition: Std, webkitSpeechRecognition: FakeRecognition })).toBe(Std);
  });
});

describe('readTranscript', () => {
  it('joins the results and reports whether the last one is final', () => {
    const r = (t: string, f: boolean) => Object.assign([{ transcript: t, confidence: 1 }], { isFinal: f, length: 1 });
    expect(readTranscript({ results: { length: 1, 0: r(' 你好 ', false) } } as never)).toEqual({ text: '你好', isFinal: false });
    expect(readTranscript({ results: { length: 2, 0: r('你好', true), 1: r('嗎', true) } } as never)).toEqual({ text: '你好嗎', isFinal: true });
  });
});

describe('speechErrorText', () => {
  it('maps the common errors to short Chinese lines; a self-inflicted stop says nothing', () => {
    expect(speechErrorText('not-allowed')).toBe('需要允許麥克風權限');
    expect(speechErrorText('no-speech')).toBe('沒有聽到聲音，再試一次？');
    expect(speechErrorText('network')).toBe('語音辨識無法使用，請改用鍵盤聽寫');
    expect(speechErrorText('service-not-allowed')).toBe('語音辨識無法使用，請改用鍵盤聽寫');
    expect(speechErrorText('aborted')).toBe('');
    expect(speechErrorText('no-start')).toBe('語音辨識沒有啟動，請改用鍵盤上的麥克風（聽寫）');
  });
  it('the mic note adds the stage code to the two watchdog messages only', () => {
    expect(speechNoteText('no-start')).toBe('語音辨識沒有啟動，請改用鍵盤上的麥克風（聽寫）（no-start）');
    expect(speechNoteText('no-speech')).toBe('沒有聽到聲音，再試一次？（no-speech）');
    expect(speechNoteText('network')).toBe('語音辨識無法使用，請改用鍵盤聽寫');
    expect(speechNoteText('aborted')).toBe('');
  });
});

describe('useSpeechInput', () => {
  it('unsupported browser: supported=false, start() reports it and never creates a recognizer', () => {
    delete w.webkitSpeechRecognition;
    const onError = vi.fn();
    const { box, unmount } = mount({ onError });
    expect(box.api?.supported).toBe(false);
    act(() => box.api?.start());
    expect(onError).toHaveBeenCalledWith('unsupported');
    expect(FakeRecognition.made).toHaveLength(0);
    unmount();
  });

  it('the lang option is read at each start: en-US when asked, zh-TW by default', () => {
    const opts = { lang: 'en-US' as string | undefined };
    const box: { api?: Api } = {};
    const Probe = () => { box.api = useSpeechInput({}, opts); return null; };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    act(() => root.render(createElement(Probe)));
    act(() => box.api?.start());
    expect(FakeRecognition.made[0]).toMatchObject({ lang: 'en-US' });
    act(() => box.api?.stop());
    act(() => FakeRecognition.made[0].onend?.());
    opts.lang = undefined;
    act(() => root.render(createElement(Probe)));
    act(() => box.api?.start());
    expect(FakeRecognition.made[1]).toMatchObject({ lang: 'zh-TW' });
    act(() => root.unmount());
  });

  it('start configures zh-TW and listens; a second start while running is ignored', () => {
    const { box, unmount } = mount({});
    expect(box.api?.supported).toBe(true);
    act(() => box.api?.start());
    act(() => box.api?.start());
    expect(FakeRecognition.made).toHaveLength(1);
    const r = FakeRecognition.made[0];
    expect(r).toMatchObject({ lang: 'zh-TW', interimResults: true, continuous: false, maxAlternatives: 1, started: 1 });
    expect(box.api?.listening).toBe(true);
    unmount();
  });

  it('interim -> onPartial, final -> onFinal, end -> onEnd(true) and listening false', () => {
    const onPartial = vi.fn(), onFinal = vi.fn(), onEnd = vi.fn(), onStart = vi.fn();
    const { box, unmount } = mount({ onPartial, onFinal, onEnd, onStart });
    act(() => box.api?.start());
    const r = FakeRecognition.made[0];
    act(() => r.onstart?.());
    expect(onStart).toHaveBeenCalledTimes(1);
    act(() => r.emit('你好', false));
    expect(onPartial).toHaveBeenLastCalledWith('你好');
    act(() => r.emit('你好嗎', true));
    expect(onFinal).toHaveBeenCalledWith('你好嗎');
    act(() => r.onend?.());
    expect(onEnd).toHaveBeenCalledWith(true);
    expect(box.api?.listening).toBe(false);
    unmount();
  });

  it('empty final text is not sent: onEnd(false) so the caller can stop listening', () => {
    const onFinal = vi.fn(), onEnd = vi.fn();
    const { box, unmount } = mount({ onFinal, onEnd });
    act(() => box.api?.start());
    const r = FakeRecognition.made[0];
    act(() => r.emit('  ', true));
    act(() => r.onend?.());
    expect(onFinal).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith(false);
    unmount();
  });

  it('error -> onError with the browser code; the session still ends cleanly', () => {
    const onError = vi.fn(), onEnd = vi.fn();
    const { box, unmount } = mount({ onError, onEnd });
    act(() => box.api?.start());
    const r = FakeRecognition.made[0];
    act(() => r.onerror?.({ error: 'not-allowed' }));
    expect(onError).toHaveBeenCalledWith('not-allowed');
    act(() => r.onend?.());
    expect(onEnd).toHaveBeenCalledWith(false);
    expect(box.api?.listening).toBe(false);
    // a new session can start afterwards
    act(() => box.api?.start());
    expect(FakeRecognition.made).toHaveLength(2);
    unmount();
  });

  it('stop() asks the recognizer to finish; unmount aborts and later events are ignored', () => {
    const onFinal = vi.fn(), onEnd = vi.fn();
    const { box, unmount } = mount({ onFinal, onEnd });
    act(() => box.api?.start());
    const r = FakeRecognition.made[0];
    act(() => box.api?.stop());
    expect(r.stopped).toBe(1);
    unmount();
    expect(r.aborted).toBe(1);
    r.emit('遲到的文字', true);
    r.onend?.();
    expect(onFinal).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe('useSpeechInput watchdogs', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

  it('never fires onstart: after 2 s it aborts, reports no-start and stops listening', () => {
    const onError = vi.fn(), onEnd = vi.fn();
    const { box, unmount } = mount({ onError, onEnd });
    act(() => box.api?.start());
    const r = FakeRecognition.made[0];
    tick(1999);
    expect(onError).not.toHaveBeenCalled();
    tick(1);
    expect(r.aborted).toBe(1);
    expect(onError).toHaveBeenCalledWith('no-start');
    expect(onEnd).toHaveBeenCalledWith(false);
    expect(box.api?.listening).toBe(false);
    // a late onstart from the dead session is ignored, and a new session can start
    act(() => r.onstart?.());
    expect(onError).toHaveBeenCalledTimes(1);
    act(() => box.api?.start());
    expect(FakeRecognition.made).toHaveLength(2);
    unmount();
  });

  it('onaudiostart counts as started: no no-start error', () => {
    const onError = vi.fn();
    const { box, unmount } = mount({ onError });
    act(() => box.api?.start());
    const r = FakeRecognition.made[0];
    act(() => r.onaudiostart?.());
    tick(5000);
    expect(onError).not.toHaveBeenCalledWith('no-start');
    expect(box.api?.listening).toBe(true);
    unmount();
  });

  it('started but no result for 7 s: stop(); with no onend after 1.5 s it aborts and reports no-speech', () => {
    const onError = vi.fn(), onEnd = vi.fn();
    const { box, unmount } = mount({ onError, onEnd });
    act(() => box.api?.start());
    const r = FakeRecognition.made[0];
    act(() => r.onstart?.());
    tick(6999);
    expect(r.stopped).toBe(0);
    tick(1);
    expect(r.stopped).toBe(1);
    tick(1499);
    expect(r.aborted).toBe(0);
    tick(1);
    expect(r.aborted).toBe(1);
    expect(onError).toHaveBeenCalledWith('no-speech');
    expect(onError).not.toHaveBeenCalledWith('no-start');
    expect(onEnd).toHaveBeenCalledWith(false);
    expect(box.api?.listening).toBe(false);
    unmount();
  });

  it('silence stop where onend does arrive: reported once, as no-speech', () => {
    const onError = vi.fn(), onEnd = vi.fn();
    const { box, unmount } = mount({ onError, onEnd });
    act(() => box.api?.start());
    const r = FakeRecognition.made[0];
    act(() => r.onstart?.());
    tick(7000);
    act(() => r.onend?.());
    tick(5000);
    expect(r.aborted).toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('no-speech');
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(box.api?.listening).toBe(false);
    unmount();
  });

  it('a result cancels the silence watchdog; max 15 s stops quietly', () => {
    const onError = vi.fn(), onEnd = vi.fn(), onPartial = vi.fn();
    const { box, unmount } = mount({ onError, onEnd, onPartial });
    act(() => box.api?.start());
    const r = FakeRecognition.made[0];
    act(() => r.onstart?.());
    tick(3000);
    act(() => r.emit('你好', false));
    tick(10000); // 13 s: past the silence timeout, but a result came, and it is not yet 15 s
    expect(r.stopped).toBe(0);
    tick(2000); // 15 s: max duration
    expect(r.stopped).toBe(1);
    tick(1500);
    expect(r.aborted).toBe(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith(false);
    expect(box.api?.listening).toBe(false);
    unmount();
  });

  it('stop() by the user without onend: aborts after 1.5 s and ends listening', () => {
    const onEnd = vi.fn(), onError = vi.fn();
    const { box, unmount } = mount({ onEnd, onError });
    act(() => box.api?.start());
    const r = FakeRecognition.made[0];
    act(() => r.onstart?.());
    act(() => box.api?.stop());
    expect(r.stopped).toBe(1);
    tick(1499);
    expect(onEnd).not.toHaveBeenCalled();
    tick(1);
    expect(r.aborted).toBe(1);
    expect(onEnd).toHaveBeenCalledWith(false);
    expect(onError).not.toHaveBeenCalled();
    expect(box.api?.listening).toBe(false);
    unmount();
  });

  it('a final text with no onend: delivered at once, session ends 1.2 s after the last result', () => {
    const onFinal = vi.fn(), onEnd = vi.fn();
    const { box, unmount } = mount({ onFinal, onEnd });
    act(() => box.api?.start());
    const r = FakeRecognition.made[0];
    act(() => r.onstart?.());
    act(() => r.emit('你好嗎', true));
    expect(onFinal).toHaveBeenCalledWith('你好嗎');
    tick(1199);
    expect(onEnd).not.toHaveBeenCalled();
    tick(1);
    expect(r.aborted).toBe(1);
    expect(onEnd).toHaveBeenCalledWith(true);
    expect(box.api?.listening).toBe(false);
    unmount();
  });

  it('normal path: onresult then onend clears every timer (nothing fires afterwards)', () => {
    const onError = vi.fn(), onEnd = vi.fn(), onFinal = vi.fn();
    const { box, unmount } = mount({ onError, onEnd, onFinal });
    act(() => box.api?.start());
    const r = FakeRecognition.made[0];
    act(() => r.onstart?.());
    act(() => r.emit('你好', true));
    act(() => r.onend?.());
    expect(onEnd).toHaveBeenCalledWith(true);
    tick(20000);
    expect(r.stopped).toBe(0);
    expect(r.aborted).toBe(0);
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('unmount clears the watchdogs: nothing fires afterwards', () => {
    const onError = vi.fn(), onEnd = vi.fn();
    const { box, unmount } = mount({ onError, onEnd });
    act(() => box.api?.start());
    const r = FakeRecognition.made[0];
    unmount();
    expect(r.aborted).toBe(1);
    tick(20000);
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(r.stopped).toBe(0);
  });
});

describe('useSpeechInput dictation', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
  const dictMount = (handlers: SpeechHandlers) => {
    const box: { api?: Api } = {};
    const Probe = () => { box.api = useSpeechInput(handlers, { dictation: true }); return null; };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    act(() => root.render(createElement(Probe)));
    return { box, unmount: () => act(() => root.unmount()) };
  };
  const last = () => FakeRecognition.made[FakeRecognition.made.length - 1];

  it('a session end (onend) starts the next session at once, same lang, listening stays on, onEnd not called', () => {
    const onEnd = vi.fn(), onError = vi.fn(), onStart = vi.fn(), onFinal = vi.fn();
    const { box, unmount } = dictMount({ onEnd, onError, onStart, onFinal });
    act(() => box.api?.start());
    act(() => last().onstart?.());
    act(() => last().emit('你好', true));
    act(() => last().onend?.());
    expect(FakeRecognition.made).toHaveLength(2);
    expect(FakeRecognition.made[1]).toMatchObject({ lang: 'zh-TW', started: 1 });
    expect(box.api?.listening).toBe(true);
    expect(onFinal).toHaveBeenCalledWith('你好');
    expect(onEnd).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    // the new session starts: onStart does not fire again
    act(() => last().onstart?.());
    expect(onStart).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('a silence restart is quiet: no error, no onEnd, a new session', () => {
    const onEnd = vi.fn(), onError = vi.fn();
    const { box, unmount } = dictMount({ onEnd, onError });
    act(() => box.api?.start());
    act(() => last().onstart?.());
    tick(7000);
    expect(last().stopped).toBe(1);
    act(() => last().onend?.());
    expect(FakeRecognition.made).toHaveLength(2);
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(box.api?.listening).toBe(true);
    unmount();
  });

  it('the silence watchdog without an onend ends the session after 1.5 s and the next one starts quietly', () => {
    const onError = vi.fn();
    const { box, unmount } = dictMount({ onError });
    act(() => box.api?.start());
    act(() => last().onstart?.());
    tick(7000 + 1500);
    expect(FakeRecognition.made[0].aborted).toBe(1);
    expect(FakeRecognition.made).toHaveLength(2);
    expect(onError).not.toHaveBeenCalled();
    unmount();
  });

  it('stop() ends the dictation: the last final text still arrives, no new session, onEnd once', () => {
    const onEnd = vi.fn(), onFinal = vi.fn();
    const { box, unmount } = dictMount({ onEnd, onFinal });
    act(() => box.api?.start());
    const r = last();
    act(() => r.onstart?.());
    act(() => box.api?.stop());
    expect(r.stopped).toBe(1);
    act(() => r.emit('最後一句', true));
    expect(onFinal).toHaveBeenCalledWith('最後一句');
    act(() => r.onend?.());
    expect(FakeRecognition.made).toHaveLength(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(true);
    expect(box.api?.listening).toBe(false);
    tick(20000);
    expect(FakeRecognition.made).toHaveLength(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('stop() while a restart is pending (no session) ends the dictation at once', () => {
    const onEnd = vi.fn();
    const { box, unmount } = dictMount({ onEnd });
    act(() => box.api?.start());
    act(() => last().onstart?.());
    act(() => last().onerror?.({ error: 'network' }));
    act(() => last().onend?.()); // a non-fatal error restarts after 300 ms
    act(() => box.api?.stop());
    expect(onEnd).toHaveBeenCalledTimes(1);
    tick(1000);
    expect(FakeRecognition.made).toHaveLength(1);
    expect(box.api?.listening).toBe(false);
    unmount();
  });

  it.each(['not-allowed', 'service-not-allowed', 'audio-capture'])('a fatal error (%s) ends the dictation with that error', (code) => {
    const onError = vi.fn(), onEnd = vi.fn();
    const { box, unmount } = dictMount({ onError, onEnd });
    act(() => box.api?.start());
    act(() => last().onstart?.());
    act(() => last().onerror?.({ error: code }));
    act(() => last().onend?.());
    expect(onError).toHaveBeenCalledWith(code);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(false);
    expect(FakeRecognition.made).toHaveLength(1);
    expect(box.api?.listening).toBe(false);
    unmount();
  });

  it('a non-fatal error (network) restarts after 300 ms without an error message', () => {
    const onError = vi.fn(), onEnd = vi.fn();
    const { box, unmount } = dictMount({ onError, onEnd });
    act(() => box.api?.start());
    act(() => last().onstart?.());
    act(() => last().onerror?.({ error: 'network' }));
    act(() => last().onend?.());
    expect(FakeRecognition.made).toHaveLength(1);
    tick(299);
    expect(FakeRecognition.made).toHaveLength(1);
    tick(1);
    expect(FakeRecognition.made).toHaveLength(2);
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    unmount();
  });

  it('no-start twice in a row is fatal: reported as no-start, the dictation ends', () => {
    const onError = vi.fn(), onEnd = vi.fn();
    const { box, unmount } = dictMount({ onError, onEnd });
    act(() => box.api?.start());
    tick(2000); // the first session never starts: aborted, the next one starts after 300 ms
    expect(onError).not.toHaveBeenCalled();
    tick(300);
    expect(FakeRecognition.made).toHaveLength(2);
    tick(2000); // the second one never starts either
    expect(onError).toHaveBeenCalledWith('no-start');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(FakeRecognition.made).toHaveLength(2);
    expect(box.api?.listening).toBe(false);
    unmount();
  });

  it('no result for 60 s stops the dictation (onEnd once)', () => {
    const onEnd = vi.fn(), onError = vi.fn();
    const { box, unmount } = dictMount({ onEnd, onError });
    act(() => box.api?.start());
    act(() => last().onstart?.());
    // a session that ends cleanly every 5 s: no watchdog fires, and no result comes
    const cycle = (ms: number) => { tick(ms); act(() => last().onend?.()); act(() => last().onstart?.()); };
    for (let k = 0; k < 11; k++) cycle(5000); // t = 55 s
    expect(FakeRecognition.made).toHaveLength(12);
    tick(4999); // 59.999 s: not yet
    expect(onEnd).not.toHaveBeenCalled();
    expect(last().stopped).toBe(0);
    tick(1); // 60 s without a result: the current session is asked to stop
    expect(last().stopped).toBe(1);
    expect(onEnd).not.toHaveBeenCalled();
    tick(1500);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(box.api?.listening).toBe(false);
    expect(FakeRecognition.made).toHaveLength(12);
    unmount();
  });

  it('a result re-arms the 60 s limit', () => {
    const onEnd = vi.fn();
    const { box, unmount } = dictMount({ onEnd });
    act(() => box.api?.start());
    act(() => last().onstart?.());
    const cycle = (ms: number) => { tick(ms); act(() => last().onend?.()); act(() => last().onstart?.()); };
    for (let k = 0; k < 10; k++) cycle(5000); // t = 50 s, sessions end cleanly, no result yet
    act(() => last().emit('你好', false)); // the 60 s limit now runs from here: t = 110 s
    for (let k = 0; k < 10; k++) cycle(5000); // t = 100 s
    cycle(4999); // t = 104.999 s, a fresh session
    expect(onEnd).not.toHaveBeenCalled();
    expect(last().stopped).toBe(0);
    tick(5001); // t = 110 s: 60 s since the result
    expect(last().stopped).toBe(1);
    unmount();
  });

  it('an utterance cut off by a session end (no final) is delivered as final before the next session', () => {
    const onFinal = vi.fn();
    const { box, unmount } = dictMount({ onFinal });
    act(() => box.api?.start());
    act(() => last().onstart?.());
    act(() => last().emit('我想問', false));
    act(() => last().onend?.());
    expect(onFinal).toHaveBeenCalledWith('我想問');
    expect(FakeRecognition.made).toHaveLength(2);
    unmount();
  });

  it('unmount in dictation: nothing fires afterwards (no restart, no onEnd)', () => {
    const onEnd = vi.fn();
    const { box, unmount } = dictMount({ onEnd });
    act(() => box.api?.start());
    act(() => last().onstart?.());
    act(() => last().onend?.());
    expect(FakeRecognition.made).toHaveLength(2);
    unmount();
    tick(70000);
    expect(FakeRecognition.made).toHaveLength(2);
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe('useSpeechInput results, session end and holdSession', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
  const mountWith = (handlers: SpeechHandlers, opts: SpeechOptions) => {
    const box: { api?: Api } = {};
    const Probe = () => { box.api = useSpeechInput(handlers, opts); return null; };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    act(() => root.render(createElement(Probe)));
    return { box, unmount: () => act(() => root.unmount()) };
  };
  const last = () => FakeRecognition.made[FakeRecognition.made.length - 1];
  // a recognition event listing all results of the session, as the browser does
  const event = (items: [string, boolean][]) => {
    const list: Record<number, unknown> = {};
    items.forEach(([t, f], i) => { list[i] = Object.assign([{ transcript: t, confidence: 1 }], { isFinal: f, length: 1 }); });
    return { results: { length: items.length, ...list } } as never;
  };

  it('onResults gets every result of the event in order, and onSessionEnd runs before the next session starts', () => {
    const onResults = vi.fn(), onSessionEnd = vi.fn();
    const { box, unmount } = mountWith({ onResults, onSessionEnd }, { dictation: true });
    act(() => box.api?.start());
    act(() => last().onstart?.());
    act(() => last().onresult?.(event([['hello there', true], ['general', false]])));
    expect(onResults).toHaveBeenLastCalledWith([
      { transcript: 'hello there', isFinal: true },
      { transcript: 'general', isFinal: false },
    ]);
    expect(onSessionEnd).not.toHaveBeenCalled();
    act(() => last().onend?.());
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
    expect(FakeRecognition.made).toHaveLength(2);
    unmount();
  });

  it('holdSession: a final text does not cut the session after 1.2 s, and 15 s does not either', () => {
    const { box, unmount } = mountWith({}, { dictation: true, holdSession: true });
    act(() => box.api?.start());
    act(() => last().onstart?.());
    act(() => last().onresult?.(event([['one', true]])));
    tick(20000);
    expect(last().stopped).toBe(0);
    expect(last().aborted).toBe(0);
    expect(FakeRecognition.made).toHaveLength(1);
    unmount();
  });

  it('without holdSession the same session is cut: 1.2 s after a final text, 15 s in total', () => {
    const { box, unmount } = mountWith({}, { dictation: true });
    act(() => box.api?.start());
    act(() => last().onstart?.());
    act(() => last().onresult?.(event([['one', true]])));
    tick(1300);
    expect(FakeRecognition.made[0].aborted).toBe(1);
    expect(FakeRecognition.made).toHaveLength(2);
    unmount();
  });
});
