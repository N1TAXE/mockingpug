/**
 * Cyrillic (Russian) -> Latin transliteration table used by {@link slugify}.
 * Multi-char mappings (`х`->`kh`, `щ`->`shch`, ...) intentionally keep the
 * result readable in a URL slug rather than aiming for a linguistic standard.
 */
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Transliterates + slugifies `input`: lowercases, maps Cyrillic characters to
 * their closest Latin equivalent, strips Latin diacritics (`é` -> `e`), then
 * collapses every remaining run of non `a-z0-9` characters into a single
 * `separator`. An empty `separator` concatenates words with nothing between
 * them instead of collapsing/trimming (there's nothing to collapse).
 */
export function slugify(input: string, separator: string): string {
  const lowered = input.toLowerCase();
  let mapped = '';
  for (const char of lowered) {
    mapped += CYRILLIC_TO_LATIN[char] ?? char;
  }
  const ascii = Array.from(mapped.normalize('NFD'))
    .filter((ch) => {
      const code = ch.codePointAt(0)!;
      return code < 0x300 || code > 0x36f; // strip Unicode combining diacritical marks
    })
    .join('');

  let slug = ascii.replace(/[^a-z0-9]+/g, separator);
  if (separator !== '') {
    const esc = escapeRegExp(separator);
    slug = slug
      .replace(new RegExp(`^(?:${esc})+`), '')
      .replace(new RegExp(`(?:${esc})+$`), '')
      .replace(new RegExp(`(?:${esc}){2,}`, 'g'), separator);
  }
  return slug;
}
