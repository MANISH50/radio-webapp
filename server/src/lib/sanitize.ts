// Control (Cc), format (Cf: zero-width, bidi overrides, BOM) and line/paragraph separators.
export const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** Normalises untrusted text for display as plain text. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Splits a comma-separated upstream field into a deduplicated, lowercased list. */
export function cleanList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (typeof value !== 'string') return [];
  const out = new Set<string>();
  for (const part of value.split(',')) {
    const item = cleanText(part, maxLen).toLowerCase();
    if (item) out.add(item);
    if (out.size >= maxItems) break;
  }
  return [...out];
}

/** Returns a normalised http(s) URL without credentials, or null. */
export function safeHttpUrl(value: unknown, max = 2048): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url.toString();
}
