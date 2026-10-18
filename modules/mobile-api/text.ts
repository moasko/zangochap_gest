// Recherche tolerante aux fautes pour l'API mobile (meme logique que l'application).

/** Minuscules, sans accents ni ponctuation. */
export function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Distance d'edition bornee (s'arrete des que max est depasse). */
export function editDistance(a: string, b: string, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

/**
 * Score (0 = aucune correspondance) d'un texte deja normalise. Chaque mot de la requete doit
 * correspondre : prefixe (3), inclusion (2) ou faute de frappe (1 faute <= 5 lettres, 2 au-dela).
 */
export function fuzzyScore(query: string, normalizedText: string) {
  const terms = normalizeText(query).split(" ").filter(Boolean);
  if (terms.length === 0) return 0;
  const words = normalizedText.split(" ").filter(Boolean);
  let score = 0;
  for (const term of terms) {
    let best = 0;
    for (const word of words) {
      if (word.startsWith(term)) best = Math.max(best, 3);
      else if (word.includes(term)) best = Math.max(best, 2);
      else if (term.length >= 3) {
        const tolerance = term.length <= 5 ? 1 : 2;
        if (editDistance(term, word.slice(0, term.length + tolerance), tolerance) <= tolerance) best = Math.max(best, 1);
      }
    }
    if (best === 0) return 0;
    score += best;
  }
  return score;
}

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "XXXXL", "4XL", "5XL", "6XL"];

/** Tri naturel des tailles : lettres (XS → 6XL), puis pointures/nombres, puis le reste. */
export function compareSizes(a: string, b: string) {
  const rank = (size: string) => {
    const upper = size.trim().toUpperCase();
    const letter = SIZE_ORDER.indexOf(upper);
    if (letter >= 0) return [0, letter] as const;
    const numeric = Number.parseFloat(upper.replace(",", "."));
    if (Number.isFinite(numeric)) return [1, numeric] as const;
    return [2, 0] as const;
  };
  const [ga, va] = rank(a);
  const [gb, vb] = rank(b);
  return ga - gb || va - vb || a.localeCompare(b);
}
