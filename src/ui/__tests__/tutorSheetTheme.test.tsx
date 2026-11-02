// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsSheet } from '../SettingsSections';
import { TipsSheet } from '../TipsSheet';
import { LookupSheet } from '../LookupSheet';

// the sheets opened from the tutor's top bar get the dark class (their backdrop carries .sheet-dark); the other callers pass no theme
// and keeps the light sheets
describe('sheet theme', () => {
  it('英語家教 opens 設定, 速查 and 小提醒 with the dark class', async () => {
    const TutorView = (await import('../TutorView')).default;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<TutorView onBack={() => {}} />); });
    const open = async (label: string) => {
      const btn = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label')?.startsWith(label));
      expect(btn, label).toBeTruthy();
      await act(async () => { btn!.click(); });
      const backdrop = host.querySelector('.sheet-backdrop');
      expect(backdrop?.classList.contains('sheet-dark'), label).toBe(true);
      expect(backdrop?.querySelector('.sheet')?.getAttribute('role')).toBe('dialog');
      // close it again
      await act(async () => { host.querySelector<HTMLButtonElement>('.sheet-close')!.click(); });
      expect(host.querySelector('.sheet-backdrop')).toBeNull();
    };
    await open('人物');
    await open('設定');
    await open('速查');
    await open('小提醒');
    act(() => root.unmount());
    host.remove();
  }, 60_000);

  it('the shared sheets stay light without the theme', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<>
        <SettingsSheet onClose={() => {}}><h3>x</h3></SettingsSheet>
        <TipsSheet onClose={() => {}} />
        <LookupSheet onClose={() => {}} ready={false} />
      </>);
    });
    const backdrops = [...host.querySelectorAll('.sheet-backdrop')];
    expect(backdrops.length).toBe(3);
    expect(backdrops.some((b) => b.classList.contains('sheet-dark'))).toBe(false);
    act(() => root.unmount());
    host.remove();
  }, 60_000);
});
