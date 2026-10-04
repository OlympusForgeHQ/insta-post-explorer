// The owner-defined taxonomy is independent of geographic provider categories.
export const PLACE_CATEGORY_KEYS = ["restaurant", "cafe", "patisserie", "voyage", "divers"] as const;
export type PlaceCategoryGroupKey = (typeof PLACE_CATEGORY_KEYS)[number];
export type PlaceCategoryGroup = { key: PlaceCategoryGroupKey; label: string; icon: string; prefixes: readonly string[]; includesBrunch?: boolean };
export const PLACE_CATEGORY_GROUPS: readonly PlaceCategoryGroup[] = [
  { key: "restaurant", label: "Restaurant", icon: "🍽️", prefixes: ["restaurant"] },
  { key: "cafe", label: "Café & brunch", icon: "☕", prefixes: ["cafe"], includesBrunch: true },
  { key: "patisserie", label: "Pâtisserie", icon: "🍰", prefixes: ["patisserie"] },
  { key: "voyage", label: "Voyage", icon: "🌍", prefixes: ["voyage"] },
  { key: "divers", label: "Divers", icon: "📍", prefixes: ["divers"] },
];
export const PLACE_CLASSIFICATION_RULES = `Classify each actual venue or destination from the post description, audio and visible text.
Use only: restaurant (restaurants and meals), cafe (cafes, coffee shops and brunch), patisserie (pastry/bakery specialists), voyage (travel destinations, accommodation and attractions), divers (unknown or other).
Prefer a clearly described cafe/brunch or pastry specialty over the generic restaurant class. Do not classify from the post theme or geographic provider category. Cite the content supporting the classification; use divers when the type is unknown.`;

export function isPlaceCategoryGroup(value: unknown): value is PlaceCategoryGroupKey {
  return typeof value === "string" && (PLACE_CATEGORY_KEYS as readonly string[]).includes(value);
}
export function groupForRawCategory(raw: string | null | undefined): PlaceCategoryGroupKey {
  const value = (raw ?? "").trim().toLowerCase();
  return isPlaceCategoryGroup(value) ? value : "divers";
}
// Legacy *model* proposals remain importable; provider strings never map here.
export function categoryFromProposal(value: string): PlaceCategoryGroupKey {
  if (isPlaceCategoryGroup(value)) return value;
  return ["lodging", "landmark", "city", "region"].includes(value) ? "voyage" : "divers";
}
export function rawCategoryPrefixesForGroups(groups: readonly PlaceCategoryGroupKey[]): string[] {
  return [...new Set(groups)];
}
export function parseCategoryGroups(value: string | null | undefined): PlaceCategoryGroupKey[] {
  return [...new Set((value ?? "").split(",").map(v => v.trim().toLowerCase()).filter(isPlaceCategoryGroup))];
}
