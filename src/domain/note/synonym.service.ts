import type { IVaultAdvanced } from "../../tools/advanced/vault-advanced.interface.js";
import { normalizeText } from "../../utils/string.utils.js";

export type SynonymMode = "off" | "basic" | "project";
export type SynonymDict = Record<string, string[]>;

export type ExpandedToken = {
  token: string;
  source: "direct" | "synonym";
  originalToken?: string;
  group?: string;
};

export type ProjectSynonymsResult = {
  dict: SynonymDict | null;
  warning?: string;
};

const PROJECT_SYNONYMS_PATH = ".markdown-vault/synonyms.json";
const MAX_SYNONYM_GROUPS = 200;
const MAX_TERMS_PER_GROUP = 50;
const MAX_TERM_LENGTH = 80;
const PROJECT_SYNONYMS_WARNING =
  `Project synonyms file exists but could not be parsed: ${PROJECT_SYNONYMS_PATH}`;

export const BASIC_SYNONYM_DICT: SynonymDict = {
  api: ["endpoint", "rest", "interface"],
  auth: ["autenticacao", "autorizacao", "login", "jwt", "oauth"],
  database: ["db", "banco de dados", "postgres", "sql"],
  docker: ["container", "containers", "imagem", "compose"],
  docs: ["documentacao", "readme", "guia"],
  test: ["teste", "testes", "spec", "unitario"],
};

function normalizeTerm(term: string): string {
  return normalizeText(term).trim();
}

function groupTermsWithName(group: string, terms: string[]): string[] {
  return [...new Set([group, ...terms])];
}

export function mergeSynonymDicts(
  base: SynonymDict,
  extra?: SynonymDict | null,
): SynonymDict {
  if (!extra) return base;
  const merged: SynonymDict = {};
  for (const [group, terms] of Object.entries(base)) {
    merged[group] = [...terms];
  }
  for (const [group, terms] of Object.entries(extra)) {
    merged[group] = [...new Set([...(merged[group] ?? []), ...terms])];
  }
  return merged;
}

export function expandWithSynonyms(
  tokens: string[],
  mode: SynonymMode,
  projectDict?: SynonymDict | null,
): ExpandedToken[] {
  const expanded: ExpandedToken[] = tokens.map((token) => ({ token, source: "direct" }));
  if (mode === "off") return expanded;

  const dict =
    mode === "project" ? mergeSynonymDicts(BASIC_SYNONYM_DICT, projectDict) : BASIC_SYNONYM_DICT;

  const seen = new Set(tokens);
  for (const token of tokens) {
    for (const [group, terms] of Object.entries(dict)) {
      const groupTerms = groupTermsWithName(group, terms);
      if (!groupTerms.includes(token)) continue;
      for (const term of groupTerms) {
        if (seen.has(term)) continue;
        seen.add(term);
        expanded.push({ token: term, source: "synonym", originalToken: token, group });
      }
    }
  }

  return expanded;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSynonymDict(raw: string): SynonymDict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;

  const entries = Object.entries(parsed);
  if (entries.length === 0 || entries.length > MAX_SYNONYM_GROUPS) return null;

  const dict: SynonymDict = {};
  for (const [rawGroup, rawTerms] of entries) {
    if (!rawGroup.trim() || rawGroup.length > MAX_TERM_LENGTH) return null;
    if (!Array.isArray(rawTerms) || rawTerms.length === 0 || rawTerms.length > MAX_TERMS_PER_GROUP) {
      return null;
    }

    const terms: string[] = [];
    for (const rawTerm of rawTerms) {
      if (typeof rawTerm !== "string" || !rawTerm.trim() || rawTerm.length > MAX_TERM_LENGTH) {
        return null;
      }
      terms.push(normalizeTerm(rawTerm));
    }
    dict[normalizeTerm(rawGroup)] = terms;
  }

  return dict;
}

export async function loadProjectSynonyms(vault: IVaultAdvanced): Promise<ProjectSynonymsResult> {
  const abs = await vault.resolveVaultPath(PROJECT_SYNONYMS_PATH);
  const exists = await vault.fileExists(abs);
  if (!exists) return { dict: null };

  try {
    const raw = await vault.readFile(abs);
    const dict = parseSynonymDict(raw);
    if (!dict) return { dict: null, warning: PROJECT_SYNONYMS_WARNING };
    return { dict };
  } catch {
    return { dict: null, warning: PROJECT_SYNONYMS_WARNING };
  }
}
