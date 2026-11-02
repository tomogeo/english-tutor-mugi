import { describe, expect, it } from 'vitest';
import { replayText } from '../replay';

describe('replayText', () => {
  it('returns her line as it is', () => {
    expect(replayText({ from: 'her', text: 'I went to school.' })).toBe('I went to school.');
  });

  it('keeps the displayed text otherwise (the aside is dropped later by the TTS filter)', () => {
    expect(replayText({ from: 'her', text: 'Hello!（你好）' })).toBe('Hello!（你好）');
    expect(replayText({ from: 'her', text: '  好的  ' })).toBe('好的');
  });

  it('gives null for a tip line, even one that reads as her line', () => {
    expect(replayText({ from: 'her', text: '「school」的發音', tip: true })).toBeNull();
  });

  it('gives null for the user’s own lines', () => {
    expect(replayText({ from: 'me', text: '你好' })).toBeNull();
  });

  it('gives null when nothing is left to say', () => {
    expect(replayText({ from: 'her', text: '' })).toBeNull();
    expect(replayText({ from: 'her', text: '   ' })).toBeNull();
  });
});
