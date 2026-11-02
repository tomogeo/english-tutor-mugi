// Voice settings used by 英語家教 (ui/TutorView): the per-language voice group of ⚙️ 聲音
// (engine, voice, 語速, 音調).
import { cloudDefaultVoice, cloudVoiceList, type CloudEngine } from '../game/cloudTts';
import { ENGINE_CHOICES, TTS_PITCH_RANGE, TTS_RATE_RANGE, TTS_STEP, listVoices, pickVoice, previewVoice, setLangSettings, ttsSupported, type Lang, type LangVoice, type TtsEngine, type TtsSettings } from '../game/tts';

/** a voice picker: automatic (the one pickVoice chooses) or one of the installed voices of the language; 試聽 speaks a sample */
function VoiceRow({ label, lang, value, onChange }: { label: string; lang: Lang; value: string; onChange: (v: string) => void }) {
  const voices = listVoices(lang);
  const auto = ttsSupported() ? pickVoice(window.speechSynthesis.getVoices(), lang)?.name : undefined;
  // a saved voice that is no longer installed still shows, so the select does not silently fall back to the first option
  const missing = value !== '' && !voices.some((v) => v.name === value);
  return (
    <div className="as-row"><span>{label}</span>
      <select className="as-voice" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{`自動（${auto ?? '系統預設'}）`}</option>
        {voices.map((v) => <option key={v.name} value={v.name}>{`${v.name} · ${v.lang}`}</option>)}
        {missing && <option value={value}>{`${value}（未安裝）`}</option>}
      </select>
      <button type="button" className="as-try" onClick={() => previewVoice(lang)}>試聽</button>
    </div>
  );
}

/** a cloud voice picker (Azure / Google): the engine's voices from the server for one language; 試聽 speaks a sample */
function CloudVoiceRow({ label, engine, lang, value, onChange }: { label: string; engine: CloudEngine; lang: Lang; value: string; onChange: (v: string) => void }) {
  const voices = cloudVoiceList(engine, lang);
  const shown = value || cloudDefaultVoice(engine, lang); // '' is the engine's default voice
  // a saved voice the server no longer offers still shows, so the select does not silently fall back to the first option
  const missing = value !== '' && voices.length > 0 && !voices.some((v) => v.id === value);
  return (
    <div className="as-row"><span>{label}</span>
      <select className="as-voice" value={shown} onChange={(e) => onChange(e.target.value)}>
        {voices.length === 0 && <option value={shown}>{shown}</option>}
        {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        {missing && <option value={value}>{`${value}（不在清單中）`}</option>}
      </select>
      <button type="button" className="as-try" onClick={() => previewVoice(lang)}>試聽</button>
    </div>
  );
}

/**
 * One language's speech in ⚙️ 聲音: its engine, its voice (the picker of that engine), its own 語速 and 音調. 試聽 speaks a
 * sample of this language with these settings.
 */
export function LangVoiceGroup({ title, lang, tts, cloud }: { title: string; lang: Lang; tts: TtsSettings; cloud: Record<CloudEngine, boolean> | null }) {
  const s: LangVoice = tts[lang];
  const setVoice = (engine: TtsEngine, voice: string) => setLangSettings(lang, { voices: { ...s.voices, [engine]: voice } });
  return (
    <div className="as-lang">
      <h4>{title}</h4>
      <div className="as-row as-stack"><span>語音引擎</span>
        <div className="as-seg" role="radiogroup" aria-label={`${title}語音引擎`}>
          {ENGINE_CHOICES[lang].map(({ engine, label }) => (
            <button key={engine} role="radio" aria-checked={s.engine === engine} className={s.engine === engine ? 'on' : ''}
              disabled={engine !== 'browser' && !cloud?.[engine]} onClick={() => setLangSettings(lang, { engine })}>{label}</button>
          ))}
        </div>
      </div>
      {s.engine === 'browser' ? (ttsSupported()
        ? <VoiceRow label="聲音" lang={lang} value={s.voices.browser ?? ''} onChange={(v) => setVoice('browser', v)} />
        : <div className="as-row"><span>聲音<small>此瀏覽器不支援語音合成</small></span></div>)
        : <CloudVoiceRow label="聲音" engine={s.engine} lang={lang} value={s.voices[s.engine] ?? ''} onChange={(v) => setVoice(s.engine, v)} />}
      <label className="as-row"><span>語速</span>
        <input className="slider" type="range" min={TTS_RATE_RANGE.min} max={TTS_RATE_RANGE.max} step={TTS_STEP} value={s.rate}
          style={{ '--f': (s.rate - TTS_RATE_RANGE.min) / (TTS_RATE_RANGE.max - TTS_RATE_RANGE.min) } as React.CSSProperties}
          onChange={(e) => setLangSettings(lang, { rate: parseFloat(e.target.value) })} />
        <em>{s.rate.toFixed(2)}</em></label>
      <label className="as-row"><span>音調</span>
        <input className="slider" type="range" min={TTS_PITCH_RANGE.min} max={TTS_PITCH_RANGE.max} step={TTS_STEP} value={s.pitch}
          style={{ '--f': (s.pitch - TTS_PITCH_RANGE.min) / (TTS_PITCH_RANGE.max - TTS_PITCH_RANGE.min) } as React.CSSProperties}
          onChange={(e) => setLangSettings(lang, { pitch: parseFloat(e.target.value) })} />
        <em>{s.pitch.toFixed(2)}</em></label>
    </div>
  );
}
