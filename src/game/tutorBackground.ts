// 背景圖片 (the player's own backgrounds for 英語家教): each added background is one picture kept in this device's IndexedDB
// (database `mugien-art`, its `background` store, the record keyed by the background's id), never sent anywhere. PNG, JPEG or WebP
// only (an SVG is refused). The picture is scaled so its longest side is at most 2048 px and written as WebP (quality 0.85; PNG
// when the browser cannot write WebP). The one picture of older saves (key `picture`) is the background 'custom'.
import { useEffect, useState } from 'react';
import { BACKGROUND_STORE, withArtStore } from './customArt';
import { imageSizeRefusal } from './imageSize';
export { newBackgroundId } from './tutorScene';

export const BACKGROUND_ACCEPT = 'image/png,image/jpeg,image/webp';
const ACCEPT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
export const BACKGROUND_MAX_SIDE = 2048;
/** the record key of an older save's single picture; it becomes the background 'custom' */
const LEGACY_KEY = 'picture';
const LEGACY_ID = 'custom';

/**
 * The stored picture of a background; null when there is none or the storage cannot be read. The older single picture is moved
 * to the background 'custom' the first time it is read (copied to its own record, the old one removed).
 */
export async function loadBackgroundPicture(id: string): Promise<Blob | null> {
  try {
    const raw = await withArtStore(BACKGROUND_STORE, 'readonly', (s) => s.get(id));
    if (raw instanceof Blob) return raw;
    if (id !== LEGACY_ID) return null;
    const legacy = await withArtStore(BACKGROUND_STORE, 'readonly', (s) => s.get(LEGACY_KEY));
    if (!(legacy instanceof Blob)) return null;
    await withArtStore(BACKGROUND_STORE, 'readwrite', (s) => s.put(legacy, LEGACY_ID));
    await withArtStore(BACKGROUND_STORE, 'readwrite', (s) => s.delete(LEGACY_KEY));
    return legacy;
  } catch {
    return null;
  }
}

/** saves the picture of a background, replacing the stored one. Throws a Chinese message when the browser refuses the storage. */
export async function saveBackgroundPicture(blob: Blob, id: string): Promise<void> {
  try {
    await withArtStore(BACKGROUND_STORE, 'readwrite', (s) => s.put(blob, id));
  } catch {
    throw new Error('無法儲存背景圖，請確認瀏覽器允許這個網站使用儲存空間');
  }
}

/** removes the stored picture of a background. Throws a Chinese message when the storage refuses. */
export async function clearBackgroundPicture(id: string): Promise<void> {
  try {
    await withArtStore(BACKGROUND_STORE, 'readwrite', (s) => s.delete(id));
  } catch {
    throw new Error('無法清除背景圖，請再試一次');
  }
}

/** the reason a picture is refused before it is read, or null when the file type and size are fine */
export function backgroundRefusal(file: { type: string; size: number }): string | null {
  if (file.type === 'image/svg+xml') return 'SVG 圖不收，請換成 PNG、JPG 或 WebP';
  if (!ACCEPT_TYPES.includes(file.type)) return '背景圖只能選 PNG、JPG 或 WebP 圖片';
  if (file.size > MAX_INPUT_BYTES) return '圖片超過 15 MB，請換一張小一點的圖';
  return null;
}

/** checks, decodes and prepares a background picture for storage (see the header). Throws a Chinese message when refused. */
export async function prepareBackground(file: File): Promise<Blob> {
  const refused = backgroundRefusal(file);
  if (refused) throw new Error(refused);
  // the size the header declares is checked before the browser decodes anything (imageSize.ts)
  const tooBig = imageSizeRefusal(new Uint8Array(await file.arrayBuffer()));
  if (tooBig) throw new Error(tooBig);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('讀不到這張圖');
  }
  try {
    const scale = Math.min(1, BACKGROUND_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('讀不到這張圖');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const webp = await canvasBlob(canvas, 'image/webp', 0.85);
    if (webp && webp.type === 'image/webp') return webp;
    const png = await canvasBlob(canvas, 'image/png');
    if (!png) throw new Error('無法處理這張圖');
    return png;
  } finally {
    bitmap.close?.();
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/** an object URL for the picture (revoked when it changes or the view unmounts); null without a picture */
export function useBackgroundUrl(picture: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!picture) { setUrl(null); return; }
    const made = URL.createObjectURL(picture);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [picture]);
  return url;
}
