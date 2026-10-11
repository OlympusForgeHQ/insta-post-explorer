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
export const PLACE_CLASSIFICATION_RULES = `Classify each actual recommended venue or destination independently from the post description, audio and visible text. Use exactly one of these existing keys per candidate:
- restaurant: an establishment recommended primarily for meals, including restaurants, bistros and named street-food venues.
- cafe: a cafe, coffee shop, tea room or venue explicitly recommended for brunch. A restaurant promoted specifically for its brunch belongs here; an incidental coffee after dinner does not.
- patisserie: a pastry or bakery specialist recommended for its pastries, cakes or baking. A restaurant serving a dessert is still a restaurant; a bakery selling coffee is not automatically a cafe. When both bakery and brunch are explicit, use the main experience recommended for that venue.
- voyage: an actual travel destination, accommodation, attraction or natural/cultural site recommended for visiting or staying. A restaurant inside a hotel is a separate restaurant candidate only when it is independently named and recommended. A hotel offering breakfast remains accommodation.
- divers: a supported place of another type, or a place whose type is not established. This is not permission to invent a venue when the post contains no identifiable place.
Distinguish an entity's purpose from an incidental product. Classify multilingual equivalents by meaning. For mixed itineraries, attach each excerpt to the correct venue; do not transfer the cafe or pastry description of one stop to another.
Neither main_theme nor internal_tags nor a geographic provider category proves a venue's type. A cafe in a Voyages post remains cafe, and a city mentioned only as an address is not a recommended destination. Do not extract unnamed recipe locations or incidental landmarks.
At fusion, reconsider caption/OCR proposals against the full supplied context and transcript instead of copying their categories blindly. In categoryReason cite the specific source fact supporting the chosen type; evidence excerpts must remain exact. If the sources do not establish a type, choose divers rather than guess.`;

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
