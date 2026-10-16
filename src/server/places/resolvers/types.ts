import type {CityBranchSourceContext} from '@/lib/places/branch-scope';
import type { PlaceCandidate } from "@/lib/places/candidates";

// Resolver contract. The concrete Geoapify adapter lands in Phase F2. Only a
// PlaceResolver may turn a textual candidate into coordinates and a provider
// identity; the model-facing candidate contract never carries those.

export type PlaceResolutionInput = {
  candidate: PlaceCandidate;
  sourceTheme: "Voyages" | "Restaurant";
  // Trusted original input for scope validation; never sent to the provider.
  sourceContext?:CityBranchSourceContext;
  // Transient retrieval bias; never persisted or substituted as result coordinates.
  proximity?: {latitude:number;longitude:number};
};

export type ResolvedPlaceCandidate = {
  provider: "geoapify" | "google";
  providerPlaceId: string;
  displayName: string;
  // Raw provider entity name, distinct from a formatted address fallback.
  providerName?: string | null;
  // Current names returned for this entity; never aliases for its parent city.
  providerNameAliases?: string[];
  street?: string | null;
  houseNumber?: string | null;
  // Locality labels explicitly present in the provider address, not nearby areas.
  localityNames?: string[];
  // Preserve structured hierarchy without replacing canonical city/region or
  // mixing administrative labels into the provider's business-name aliases.
  administrativeLabels?: Partial<Record<'city'|'state'|'county'|'district'|'suburb'|'municipality',string>>;
  providerLocalityBoundary?: {placeId:string;name:string};
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
  providerSource?: 'geocoding' | 'places';
  providerStreetConfidence?: number | null;
  providerBuildingConfidence?: number | null;
  providerBounds?: {lon1:number;lat1:number;lon2:number;lat2:number} | null;
  providerMatchType: string | null;
  attribution: string | null;
};

export interface PlaceResolver {
  resolve(input: PlaceResolutionInput): Promise<ResolvedPlaceCandidate[]>;
}
