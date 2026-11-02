import type { ReactNode } from 'react';

// Button icons of 英語家教 / 助手: inline SVG drawn with currentColor (light on the dark buttons, --on-accent on the accent ones,
// the button's own text colour elsewhere). One style for all: 24-unit grid, stroke 2, round caps and joins.
// Each icon is decorative (aria-hidden); the button keeps its aria-label.

type IconProps = { size?: number };

function Svg({ size = 22, children }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** 設定: a gear with a hole in its middle */
export function IconGear(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.64 5.52L10.17 2.58L13.83 2.58L14.36 5.52L14.92 5.75L17.37 4.04L19.96 6.63L18.25 9.08L18.48 9.64L21.42 10.17L21.42 13.83L18.48 14.36L18.25 14.92L19.96 17.37L17.37 19.96L14.92 18.25L14.36 18.48L13.83 21.42L10.17 21.42L9.64 18.48L9.08 18.25L6.63 19.96L4.04 17.37L5.75 14.92L5.52 14.36L2.58 13.83L2.58 10.17L5.52 9.64L5.75 9.08L4.04 6.63L6.63 4.04L9.08 5.75Z" />
      <circle cx="12" cy="12" r="3.2" />
    </Svg>
  );
}

/** 關閉 (sheet close, remove a row): an X */
export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6L18 18M18 6L6 18" />
    </Svg>
  );
}

/** 展開對話: a speech bubble */
export function IconChat(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3v4l5-4h8a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
    </Svg>
  );
}

/** 收起對話: a chevron pointing down */
export function IconChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

/** 上一個 / 上個月: a chevron pointing left */
export function IconChevronLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 6l-6 6 6 6" />
    </Svg>
  );
}

/** 下一個 / 下個月: a chevron pointing right */
export function IconChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

/** 人物: a person silhouette (a head and shoulders), the 人物 sheet's button */
export function IconPerson(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21c0-4.1 3.4-7.2 7.5-7.2s7.5 3.1 7.5 7.2" />
    </Svg>
  );
}

/** 語音對話: a person speaking, with waves coming from the mouth side */
export function IconTalk(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" />
      <path d="M16.5 8.5a4.5 4.5 0 0 1 0 5" />
      <path d="M19.5 5.5a8.5 8.5 0 0 1 0 11" />
    </Svg>
  );
}

/** 語音輸入: a microphone */
export function IconMic(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="2.5" width="6" height="12" rx="3" />
      <path d="M5.5 11v1a6.5 6.5 0 0 0 13 0v-1" />
      <path d="M12 18.5V22" />
      <path d="M8.5 22h7" />
    </Svg>
  );
}

/** 停止: a filled rounded square */
export function IconStop(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5.5" y="5.5" width="13" height="13" rx="2.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** 播放 (a sentence): a loudspeaker with two waves */
export function IconSpeaker(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11 5L6 9H2.5v6H6l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.8 5.2a10 10 0 0 1 0 13.6" />
    </Svg>
  );
}

/** 選取 (the chosen colour swatch): a check mark */
export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 6L9 17l-5-5" />
    </Svg>
  );
}
