// The two study buttons of the top bar, used by 英語家教 (TutorView): 小提醒筆記本 (with the
// count of tips still being practised) and 速查 (the English lookup). Only the buttons are shared (look, icon, badge, labels);
// each view places them where it wants and decides when they show. The sheets themselves are TipsSheet / LookupSheet.
import { useEffect, useState } from 'react';
import { loadTips, onTips, unmasteredCount } from '../game/tipsBook';

/** the tip counts the 筆記本 button shows: all tips, and the ones not yet mastered; refreshed when the book changes */
export function useTipStat() {
  const [stat, setStat] = useState(() => ({ total: loadTips().length, open: unmasteredCount() }));
  useEffect(() => onTips(() => setStat({ total: loadTips().length, open: unmasteredCount() })), []);
  return stat;
}

/** 小提醒筆記本: the notebook icon, with a badge while `open` tips are still being practised */
export function TipsButton({ open, onClick }: { open: number; onClick: () => void }) {
  return (
    <button className="as-icon as-tips-btn" title="小提醒筆記本" onClick={onClick}
      aria-label={open > 0 ? `小提醒筆記本，${open} 句還在練習` : '小提醒筆記本'}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 18h6" /><path d="M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1V17h5v-1c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
      </svg>
      {open > 0 && <span className="as-tips-badge">{open}</span>}
    </button>
  );
}

/** 速查: the English lookup; without the Claude AI key (`ready` false) it is dimmed, and the sheet explains why */
export function LookupButton({ ready, onClick }: { ready: boolean; onClick: () => void }) {
  return (
    <button className={ready ? 'as-icon as-lookup-btn' : 'as-icon as-lookup-btn off'} title="速查（英語查詢）" aria-label="速查"
      aria-disabled={ready ? undefined : true} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z" /><path d="M4 19a2 2 0 0 0 2 2h13v-4" /><path d="M8 8h6" /><path d="M8 11h4" />
      </svg>
    </button>
  );
}
