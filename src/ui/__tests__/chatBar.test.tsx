// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatBar, type ChatBarProps } from '../ChatBar';

function base(over: Partial<ChatBarProps> = {}): ChatBarProps {
  return {
    inputRef: createRef<HTMLInputElement>(), value: '', onChange: () => {}, placeholder: '和她說話…',
    onSubmit: () => {}, chatOpen: false, onToggleChat: () => {},
    voice: { active: false, onToggle: () => {} }, mic: { listening: false, supported: true, onToggle: () => {} },
    ...over,
  };
}

function render(props: ChatBarProps) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<ChatBar {...props} />));
  return {
    host,
    unmount: () => { act(() => root.unmount()); host.remove(); },
    btn: (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`),
    input: () => host.querySelector<HTMLInputElement>('input[aria-label="訊息"]'),
    send: () => host.querySelector<HTMLButtonElement>('button.as-send'),
  };
}

describe('ChatBar', () => {
  it('shows the core buttons and hides the optional ones when their props are missing', () => {
    const r = render(base());
    expect(r.btn('展開對話')).toBeTruthy();
    expect(r.btn('語音對話')).toBeTruthy();
    expect(r.btn('語音輸入')).toBeTruthy();
    expect(r.btn('換她開話題')).toBeNull();
    expect(r.host.querySelector('.as-stt')).toBeNull();
    expect(r.host.querySelector('.as-voice-pill')).toBeNull();
    expect(r.host.querySelector('.as-history')).toBeNull();
    r.unmount();
  });

  it('shows the 英/中 toggle, the topic button, the pill and the history when given', () => {
    const onStop = vi.fn();
    const r = render(base({
      chatOpen: true, history: <li>hi</li>, stt: { lang: 'en-US', title: 'x', onToggle: () => {} },
      onOpenTopic: () => {}, pill: { phase: 'listening', label: '聆聽中…', onStop }, notes: [false, '提示'],
    }));
    expect(r.btn('辨識語言：英文，點一下改中文')?.textContent).toBe('英');
    expect(r.btn('換她開話題')).toBeTruthy();
    expect(r.host.querySelector('.as-voice-pill')?.textContent).toContain('聆聽中');
    expect(r.host.querySelector('.as-history li')?.textContent).toBe('hi');
    expect(r.host.querySelectorAll('.as-mic-note')).toHaveLength(1);
    expect(r.btn('收起對話')?.textContent).toBe('');
    expect(r.btn('收起對話')?.querySelector('svg')).toBeTruthy();
    r.unmount();
  });

  it('submits the text on the send button, and not while the text is empty or sendDisabled', () => {
    const onSubmit = vi.fn();
    const r = render(base({ value: 'こんにちは', onSubmit }));
    expect(r.send()!.disabled).toBe(false);
    act(() => { r.send()!.click(); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    r.unmount();

    const busy = vi.fn();
    const r2 = render(base({ value: 'a', sendDisabled: true, onSubmit: busy }));
    expect(r2.send()!.disabled).toBe(true);
    const r3 = render(base({ value: '   ' }));
    expect(r3.send()!.disabled).toBe(true);
    r2.unmount(); r3.unmount();
  });

  it('disables the input and reports taps through the given handlers', () => {
    const onToggleChat = vi.fn();
    const onOpenTopic = vi.fn();
    const voiceToggle = vi.fn();
    const r = render(base({ disabled: true, onToggleChat, onOpenTopic, voice: { active: false, disabled: true, onToggle: voiceToggle } }));
    expect(r.input()!.disabled).toBe(true);
    expect(r.btn('語音對話')!.getAttribute('aria-disabled')).toBe('true');
    act(() => { r.btn('展開對話')!.click(); });
    expect(onToggleChat).toHaveBeenCalledWith(true);
    act(() => { r.btn('換她開話題')!.click(); });
    expect(onOpenTopic).toHaveBeenCalledTimes(1);
    act(() => { r.btn('語音對話')!.click(); });
    expect(voiceToggle).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('marks the mic unsupported with aria-disabled', () => {
    const r = render(base({ mic: { listening: false, supported: false, onToggle: () => {} } }));
    expect(r.btn('語音輸入')!.getAttribute('aria-disabled')).toBe('true');
    expect(r.btn('語音輸入')!.title).not.toBe('');
    r.unmount();
  });
});
