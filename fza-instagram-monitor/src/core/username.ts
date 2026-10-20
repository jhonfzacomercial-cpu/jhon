// Normalização do @ informado no cadastro.
// Aceita: "@fulano", "fulano", " Fulano ", "instagram.com/fulano", "https://www.instagram.com/fulano/?hl=pt".
// Regras do Instagram: 1–30 caracteres, letras, números, ponto e sublinhado.

export type UsernameResult =
  | { ok: true; username: string }
  | { ok: false; error: string };

const USERNAME_RE = /^[a-z0-9._]{1,30}$/;
const RESERVED_PATHS = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'tv', 'direct']);

export function normalizeUsername(input: string): UsernameResult {
  let s = (input ?? '').trim();
  if (!s) return { ok: false, error: 'Informe o @ ou a URL do perfil.' };

  const looksLikeUrl = /instagram\.com|^https?:\/\//i.test(s) || s.includes('/');
  if (looksLikeUrl) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`);
    } catch {
      return { ok: false, error: 'URL inválida.' };
    }
    const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, '');
    if (host !== 'instagram.com') {
      return { ok: false, error: 'A URL precisa ser de instagram.com.' };
    }
    const first = url.pathname.split('/').filter(Boolean)[0];
    if (!first) return { ok: false, error: 'A URL não contém um perfil.' };
    if (RESERVED_PATHS.has(first.toLowerCase())) {
      return { ok: false, error: 'Essa URL é de uma publicação ou página do Instagram, não de um perfil.' };
    }
    s = decodeURIComponent(first);
  }

  s = s.replace(/^@+/, '').trim().toLowerCase();
  if (!USERNAME_RE.test(s)) {
    return {
      ok: false,
      error: 'O @ deve ter de 1 a 30 caracteres: letras, números, ponto (.) ou sublinhado (_).',
    };
  }
  if (s.startsWith('.') || s.endsWith('.') || s.includes('..')) {
    return { ok: false, error: 'O @ não pode começar ou terminar com ponto, nem ter pontos seguidos.' };
  }
  return { ok: true, username: s };
}

export function profileUrl(username: string): string {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}
