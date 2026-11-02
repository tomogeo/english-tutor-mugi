// The look is black and white: no pink, magenta or rose anywhere in the stylesheets, and the accent of 英語家教 is white.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const uiDir = new URL('..', import.meta.url);
const sheets: Array<{ name: string; css: string }> = [
  { name: 'src/index.css', css: readFileSync(new URL('../../index.css', import.meta.url), 'utf8') },
  ...readdirSync(uiDir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => ({ name: `src/ui/${f}`, css: readFileSync(new URL(f, uiDir), 'utf8') })),
];

/** the pink, rose and magenta values the colour scheme and the old rose look used (lower case, as they are written) */
const PINKS = [
  '#c2457a', '#e0457b', '#fdf0f4', '#ffd6e5', '#3a1f2d', '#ff6f9c', 'rgba(255, 111, 156', 'rgba(194, 69, 122',
  '#8e2f54', '#ff8fa8', '#d0456b', '#f6e7ec', '#f7e6ec', '#ffeef4', '#fff6f8', '#f1d6df', '#8a7480', '#ff8a7a',
];

describe('monochrome look', () => {
  it('no stylesheet keeps a pink, rose or magenta value', () => {
    for (const { name, css } of sheets) {
      const lower = css.toLowerCase();
      for (const pink of PINKS) {
        expect(lower.includes(pink), `${name} still has ${pink}`).toBe(false);
      }
    }
  });

  it('the colour scheme blocks are gone from tutor.css', () => {
    const tutorCss = sheets.find((s) => s.name === 'src/ui/tutor.css')!.css;
    expect(tutorCss).not.toContain('data-scheme');
    expect(tutorCss).not.toContain('as-swatch');
  });

  it('the accent of 英語家教 is white, and the text on it is near-black', () => {
    const tutorCss = sheets.find((s) => s.name === 'src/ui/tutor.css')!.css;
    expect(tutorCss).toMatch(/\.tutor \{[^}]*--accent: #(fff|ffffff);/);
    expect(tutorCss).toMatch(/--on-accent: #111111;/);
    const indexCss = sheets.find((s) => s.name === 'src/index.css')!.css;
    expect(indexCss).toMatch(/--accent: #(fff|ffffff);/);
    expect(indexCss).toMatch(/--on-accent: #111111;/);
  });
});
