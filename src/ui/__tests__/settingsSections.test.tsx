// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { AudioSettings } from '../../game/audio';
import type { TtsSettings } from '../../game/tts';
import { ChatDataSection, SettingsSheet, SoundSection, UsageSection } from '../SettingsSections';
import { LookupButton, TipsButton } from '../StudyButtons';

// the voice group and the usage panel fetch / talk to the browser: a stub each keeps the test about the rows
vi.mock('../VoiceSettings', () => ({
  LangVoiceGroup: ({ title }: { title: string }) => <div className="as-lang" data-group={title}>{title}</div>,
}));
vi.mock('../UsagePanel', () => ({ UsagePanel: () => <div className="usage-panel">usage</div> }));

const AUDIO: AudioSettings = { muted: false, master: 1, music: 0.5, voice: 1 };
const TTS = { on: true } as TtsSettings;

function render(node: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}
const labels = (host: HTMLElement) => [...host.querySelectorAll('.as-row > span:first-child')].map((s) => s.childNodes[0]?.textContent);

describe('SoundSection', () => {
  it('lists mute, the music and voice rows, 朗讀回覆 and both voice groups', () => {
    const r = render(<SoundSection audio={AUDIO} tts={TTS} cloud={null} />);
    expect(r.host.querySelector('h3')?.textContent).toBe('聲音');
    expect(labels(r.host)).toEqual(['靜音', '音樂', '語音', '朗讀回覆']);
    expect(r.host.querySelectorAll('input.slider')).toHaveLength(2);
    expect([...r.host.querySelectorAll('[data-group]')].map((g) => g.getAttribute('data-group'))).toEqual(['英文', '中文']);
    expect(r.host.textContent).toContain('雲端語音檢查中');
    r.unmount();
  });

  it('shows only the volume rows it is given', () => {
    const r = render(<SoundSection audio={AUDIO} tts={TTS} cloud={null} volumes={['voice']} />);
    expect(labels(r.host)).toEqual(['靜音', '語音', '朗讀回覆']);
    r.unmount();
  });

  it('reports the missing cloud keys once the status is known', () => {
    const cloud = { azure: false, google: true, voices: {} } as never;
    const r = render(<SoundSection audio={AUDIO} tts={TTS} cloud={cloud} />);
    expect(r.host.textContent).toContain('Azure／Google 需要在 .env.local 填金鑰');
    r.unmount();
  });
});

describe('ChatDataSection', () => {
  it('shows the chat count, clears on the button, and disables it when the chat is empty', () => {
    const onClear = vi.fn();
    const r = render(<ChatDataSection count={3} onClear={onClear} />);
    expect(r.host.querySelector('h3')?.textContent).toBe('對話');
    expect(r.host.textContent).toContain('3 則');
    r.host.querySelector<HTMLButtonElement>('button.as-small')?.click();
    expect(onClear).toHaveBeenCalledTimes(1);
    r.unmount();
    const empty = render(<ChatDataSection count={0} onClear={onClear} />);
    expect(empty.host.querySelector<HTMLButtonElement>('button.as-small')?.disabled).toBe(true);
    empty.unmount();
  });

  it('puts the view rows (children) before the chat count', () => {
    const r = render(<ChatDataSection count={0} onClear={() => {}}><div className="own">engine</div></ChatDataSection>);
    const kids = [...r.host.children].map((c) => c.className);
    expect(kids).toEqual(['', 'own', 'as-row']);
    r.unmount();
  });
});

describe('UsageSection and SettingsSheet', () => {
  it('has the 用量 heading and the usage panel', () => {
    const r = render(<UsageSection />);
    expect(r.host.querySelector('h3')?.textContent).toBe('用量');
    expect(r.host.querySelector('.usage-panel')).toBeTruthy();
    r.unmount();
  });

  it('shell: titled 設定, children in the body, close on ✕ and on the backdrop', () => {
    const onClose = vi.fn();
    const r = render(<SettingsSheet onClose={onClose}><h3>x</h3></SettingsSheet>);
    expect(r.host.querySelector('.as-settings-body h3')?.textContent).toBe('x');
    expect(r.host.querySelector('section[role="dialog"]')?.getAttribute('aria-label')).toBe('設定');
    r.host.querySelector<HTMLButtonElement>('button[aria-label="關閉"]')?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    r.host.querySelector<HTMLElement>('.sheet-backdrop')?.click();
    expect(onClose).toHaveBeenCalledTimes(2);
    r.unmount();
  });
});

describe('study buttons', () => {
  it('TipsButton shows the open count as a badge and names it in the label', () => {
    const r = render(<TipsButton open={2} onClick={() => {}} />);
    expect(r.host.querySelector('button')?.getAttribute('aria-label')).toBe('小提醒筆記本，2 句還在練習');
    expect(r.host.querySelector('.as-tips-badge')?.textContent).toBe('2');
    r.unmount();
    const none = render(<TipsButton open={0} onClick={() => {}} />);
    expect(none.host.querySelector('.as-tips-badge')).toBeNull();
    none.unmount();
  });

  it('LookupButton is dimmed and aria-disabled without the Claude key', () => {
    const onClick = vi.fn();
    const off = render(<LookupButton ready={false} onClick={onClick} />);
    const btn = off.host.querySelector('button')!;
    expect(btn.className).toBe('as-icon as-lookup-btn off');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1); // still opens its sheet
    off.unmount();
    const on = render(<LookupButton ready onClick={onClick} />);
    expect(on.host.querySelector('button')?.className).toBe('as-icon as-lookup-btn');
    expect(on.host.querySelector('button')?.hasAttribute('aria-disabled')).toBe(false);
    on.unmount();
  });
});
