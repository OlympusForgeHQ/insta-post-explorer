import type { PlaceCandidate } from "@/lib/places/candidates";

// Resolver contract. The concrete Geoapify adapter lands in Phase F2. Only a
// PlaceResolver may turn a textual candidate into coordinates and a provider
// identity; the model-facing candidate contract never carries those.

export type PlaceResolutionInput = {
  candidate: PlaceCandidate;
  sourceTheme: "Voyages" | "Restaurant";
};

export type ResolvedPlaceCandidate = {
  provider: "geoapify";
  providerPlaceId: string;
  displayName: string;
  // Raw provider entity name, distinct from a formatted address fallback.
  providerName?: string | null;
  category: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  providerResultType: string | null;
  providerRank: number | null;
  providerMatchType: string | null;
  attribution: string | null;
};

export interface PlaceResolver {
  resolve(input: PlaceResolutionInput): Promise<ResolvedPlaceCandidate[]>;
}
