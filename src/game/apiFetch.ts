// The one way the app calls the dev server's /api routes. On a LAN connection (the server runs with MUGI_LAN=1 and the phone reaches
// it by the PC's IP address) every /api request needs the pairing code the server printed once in its console: the code is typed
// once (PairBanner), kept in this browser's localStorage, and sent in the X-Mugi-Pair header on every call. Loopback and Tailscale
// names never need it, and a request without a code is simply sent without the header (the server then refuses it only on a LAN
// address). When the server answers 403 with error "pair_required", the banner asks for the code.
export const PAIR_HEADER = 'X-Mugi-Pair';
export const PAIR_PROMPT = '輸入電腦終端機顯示的配對碼';
const PAIR_KEY = 'mugien.pair.v1';

/** the stored pairing code ('' when none, or when the browser keeps no storage) */
export function pairCode(): string {
  try {
    return localStorage.getItem(PAIR_KEY) ?? '';
  } catch {
    return '';
  }
}

/** keeps the pairing code in this browser (an empty value forgets it) */
export function setPairCode(code: string): void {
  try {
    if (code) localStorage.setItem(PAIR_KEY, code);
    else localStorage.removeItem(PAIR_KEY);
  } catch {
    // storage refused: the code lasts until the page is closed only, which the banner asks again for
  }
}

const pairListeners = new Set<() => void>();
/** called when a /api request is refused for want of the pairing code; returns the unsubscribe */
export function onPairNeeded(listener: () => void): () => void {
  pairListeners.add(listener);
  return () => { pairListeners.delete(listener); };
}

/** fetch for an /api route: the pairing header is added when a code is stored; a pair_required refusal notifies the banner */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const code = pairCode();
  const sent: RequestInit = code
    ? { ...init, headers: { ...((init.headers as Record<string, string> | undefined) ?? {}), [PAIR_HEADER]: code } }
    : init;
  const response = await fetch(input, sent);
  if (response.status === 403 && input.startsWith('/api')) {
    const body = (await response.clone().json().catch(() => null)) as { error?: unknown } | null;
    if (body?.error === 'pair_required') for (const listener of pairListeners) listener();
  }
  return response;
}
