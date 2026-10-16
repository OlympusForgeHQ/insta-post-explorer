import { foldForSearch } from "@/lib/import/normalize";

export type RecentSearchScope = "posts" | "places";

const LIMIT = 5;
const MAX_TERM_LENGTH = 200;
const memory = new Map<RecentSearchScope, string[]>();
const pendingWrites = new Set<RecentSearchScope>();
const storageKey = (scope: RecentSearchScope) => `mosaic:recent-searches:v1:${scope}`;

function normalizeTerm(value: unknown): string {
  if (typeof value !== "string") return "";
  const term = value.trim().replace(/\s+/gu, " ");
  return term.length <= MAX_TERM_LENGTH ? term : "";
}

function sanitize(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const candidate of value) {
    const term = normalizeTerm(candidate);
    const key = foldForSearch(term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length === LIMIT) break;
  }
  return terms;
}

export function readRecentSearches(scope: RecentSearchScope): string[] {
  if (typeof window === "undefined") return [];
  if (!pendingWrites.has(scope)) {
    try {
      const raw = window.localStorage.getItem(storageKey(scope));
      if (raw === null) memory.set(scope, []);
      else if (raw.length <= 16_384) memory.set(scope, sanitize(JSON.parse(raw)));
    } catch {
      // Storage can be malformed or unavailable; keep this session's history.
    }
  }
  return [...(memory.get(scope) ?? [])];
}

export function rememberRecentSearch(scope: RecentSearchScope, value: string): string[] {
  const term = normalizeTerm(value);
  const previous = readRecentSearches(scope);
  if (!term) return previous;
  const terms = sanitize([term, ...previous]);
  memory.set(scope, terms);
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(terms));
    pendingWrites.delete(scope);
  } catch {
    // A failed write must not let an older stored value replace newer memory.
    pendingWrites.add(scope);
  }
  return [...terms];
}

export function clearRecentSearches(scope: RecentSearchScope): void {
  memory.set(scope, []);
  try {
    window.localStorage.removeItem(storageKey(scope));
    pendingWrites.delete(scope);
  } catch {
    pendingWrites.add(scope);
  }
}
