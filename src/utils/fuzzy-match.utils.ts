export const PROTECTED_FUZZY_TOKENS = new Set([
  "api", "db", "ui", "id", "sql", "jwt", "ci", "cd", "css", "html",
  "json", "yaml", "ts", "js", "jsx", "tsx", "md", "env", "url", "uri",
  "npm", "pnpm", "yarn",
]);

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length];
}

export function defaultMaxEditDistance(token: string): number {
  if (token.length <= 4) return 0;
  if (token.length <= 7) return 1;
  return 2;
}

export function withinFuzzyDistance(
  token: string,
  candidate: string,
  maxDistance?: number,
): boolean {
  if (token === candidate) return true;
  const limit = maxDistance ?? defaultMaxEditDistance(token);
  if (limit <= 0) return false;
  if (Math.abs(token.length - candidate.length) > limit) return false;
  return editDistance(token, candidate) <= limit;
}

export function clampMaxFuzzyDistance(token: string, input?: number): number {
  return Math.max(0, Math.min(input ?? defaultMaxEditDistance(token), 3));
}

export function isFuzzyEligible(token: string): boolean {
  return token.length > 4 && !PROTECTED_FUZZY_TOKENS.has(token);
}
