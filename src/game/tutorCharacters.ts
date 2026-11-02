// 英語家教's characters. The three built-in ones (Mugi the hamster, Lily, Ethan) and what differs for each: the chat role (the
// persona in server/prompts.ts), the default name and subtitle, the default personality text, the art (the hamster's mouth
// overlays under public/characters/mugi/, or the two pictures of Lily and Ethan), and where she stands on the classroom's lectern.
// The anchor table (ANCHORS) is the one place the numbers of the classroom stand live: numbers are shares of the classroom picture
// (game/tutorScene DEFAULT_SCENE): width = share of its width, centreX = share of its width, anchorY = share of its height, and
// pictureAnchor = the share of the character's own picture height that sits at anchorY (1 = the picture's bottom, its feet).
import type { ChatRoleId } from './claudeProtocol';
import type { FigureAnchor } from './tutorScene';

export type TutorCharacterId = string;
/** the three built-in characters: Mugi, Lily and Ethan, in the order of the tabs 1, 2, 3 */
export const BUILTIN_IDS = ['mugi', 'yui', 'yuma'] as const;
export type BuiltinId = (typeof BUILTIN_IDS)[number];
export const isBuiltinId = (id: string): id is BuiltinId => (BUILTIN_IDS as readonly string[]).includes(id);

/** the default personality of a character the player adds (人物 ＋): the box is empty, and this text is what she is told */
export const NEUTRAL_PERSONA = '親切、有耐心的英語家教，說話自然、口語。';

/** the anchor of each built-in character on the classroom's lectern (the numbers are explained at the top of this file) */
export const ANCHORS: Record<BuiltinId, FigureAnchor> = {
  // Mugi stands on the lectern: her width is 23.2% of the picture, her feet (the picture's bottom) at 58.7% of its height
  mugi: { width: 0.232, centerX: 0.5, anchorY: 0.587, pictureAnchor: 1 },
  // Lily sits on the lectern: 62% wide, the point 64% down her picture at 58.7%
  yui: { width: 0.53, centerX: 0.5, anchorY: 0.587, pictureAnchor: 0.64 },
  // Ethan stands in front of the lectern on the floor: 76% wide, his feet (the picture's bottom) at 91.5% of the picture's height
  yuma: { width: 0.76, centerX: 0.5, anchorY: 0.915, pictureAnchor: 1 },
};
/** a character the player adds, without a picture yet: a standing figure on the floor, 45% wide, its feet at 97.4% */
export const CUSTOM_ANCHOR: FigureAnchor = { width: 0.45, centerX: 0.5, anchorY: 0.974, pictureAnchor: 1 };

export type BuiltinCharacter = {
  id: BuiltinId;
  /** the chat role (server/prompts.ts PERSONA) */
  role: ChatRoleId;
  /** the art folder under public/, relative to the app's base URL */
  artDir: string;
  defaultName: string;
  /** shown under the name in the top bar (kept short: the bar is narrow on a 320 px phone) */
  subtitle: string;
  /** the default personality text sent with her requests; '' = the server's own text for the role (Mugi) */
  defaultPersona: string;
  /** the pictures: the hamster's are the mouth overlays of tutor.json; Lily and Ethan have one picture per mouth state */
  picture: 'hamster' | { open: string; closed: string };
};

export const BUILTIN_CHARACTERS: Record<BuiltinId, BuiltinCharacter> = {
  mugi: {
    id: 'mugi', role: 'Mugi', artDir: 'characters/mugi', defaultName: 'Mugi', subtitle: '倉鼠・英語家教', defaultPersona: '', picture: 'hamster',
  },
  yui: {
    id: 'yui', role: 'Mugi', artDir: 'characters/yui', defaultName: 'Lily', subtitle: '高中生・英語家教',
    defaultPersona: '十八歲、已成年的美國高三女生，來自加州，說話活潑、口語，常用美國年輕人的日常說法（但不說髒話，遇到俚語會順便解釋）；正在準備申請大學，喜歡咖啡廳、拍照和追劇，說話溫柔活潑、偶爾會開點小玩笑，像同齡朋友一樣陪你練英文。風格保持自然、非露骨，絕不涉及色情或性暗示。不閒聊太久，會把話題帶回練習。',
    picture: { open: 'a.webp', closed: 'm.webp' },
  },
  yuma: {
    id: 'yuma', role: 'Mugi', artDir: 'characters/yuma', defaultName: 'Ethan', subtitle: '大學生・英語家教',
    defaultPersona: '爽朗隨和的美國男大學生，大學三年級，喜歡籃球、音樂和到處吃美食，說話輕鬆幽默、很會鼓勵人，像學長一樣陪你練英文。風格保持自然、非露骨，絕不涉及色情或性暗示。不閒聊太久，會把話題帶回練習。',
    picture: { open: 'a.webp', closed: 'm.webp' },
  },
};

/** the subtitle Lily had before she became a third-year high-school student: a saved subtitle that is exactly this one gets the new default (tutor.ts cleanCharacter) */
export const LEGACY_YUI_SUBTITLE = '大學生・英語家教（舊）';

/** the hamster's entry, under the name the rest of the app has always used */
export const TUTOR_CHARACTER = BUILTIN_CHARACTERS.mugi;

/** the default personality of a character's id: a built-in's text, else the neutral text of an added character */
export function defaultPersonaOf(id: TutorCharacterId): string {
  return isBuiltinId(id) ? BUILTIN_CHARACTERS[id].defaultPersona : NEUTRAL_PERSONA;
}

/** the anchor of a character on the lectern: the built-in table, else the standing figure of an added character */
export function anchorOf(id: TutorCharacterId): FigureAnchor {
  return isBuiltinId(id) ? ANCHORS[id] : CUSTOM_ANCHOR;
}
