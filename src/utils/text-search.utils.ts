import { STOPWORDS } from "../config/constants.js";
import { normalizeText } from "./string.utils.js";

export function tokenize(value: string): string[] {
  const words = normalizeText(value).match(/[a-z0-9]+/g) ?? [];
  return [
    ...new Set(words.filter((word) => word.length > 1 && !STOPWORDS.has(word))),
  ];
}

export function containsAnyToken(value: string, tokens: string[]): boolean {
  const normalized = normalizeText(value);
  return tokens.some((token) => normalized.includes(token));
}

export function countTokenOccurrences(value: string, tokens: string[]): number {
  const normalized = normalizeText(value);
  let count = 0;
  for (const token of tokens) {
    let cursor = normalized.indexOf(token);
    while (cursor >= 0) {
      count += 1;
      cursor = normalized.indexOf(token, cursor + token.length);
    }
  }
  return count;
}
