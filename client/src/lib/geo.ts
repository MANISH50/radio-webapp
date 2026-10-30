/** Flag emoji from an ISO 3166-1 alpha-2 code (regional indicator symbols). */
export function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/**
 * Best-guess country from the browser's language settings only (no geolocation prompt):
 * "hi-IN" → IN, and bare languages are expanded with likely subtags ("ja" → JP).
 */
export function localeCountry(): string | null {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const lang of langs) {
    try {
      const region = new Intl.Locale(lang).maximize().region;
      if (region && /^[A-Z]{2}$/.test(region)) return region;
    } catch {
      /* malformed tag: try the next one */
    }
  }
  return null;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: n >= 10_000 ? 'compact' : 'standard' }).format(n);
}
