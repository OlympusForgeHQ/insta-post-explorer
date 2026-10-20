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
  // Distinct retrieval hints require corroboration of all sites before a
  // complementary search can imply that only one branch exists.
  minimumSites?: number;
};

export type ResearchedPlaceAddress = {
  name: string;
  streetAddress: string;
  city: string;
  country: string;
  postalCode: string | null;
  sources: {url: string; excerpt: string; title?: string}[];
  researchedAt: string;
};

export interface PlaceAddressResearch {
  search(input: PlaceResolutionInput): Promise<ResearchedPlaceAddress[]>;
}

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
  postalCode?: string | null;
  // Public-web address evidence is separate from the original post and from
  // the geographic provider's building identity. Never populated from Google.
  webResearch?: ResearchedPlaceAddress;
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
  // Request-local hints are never canonical coordinates or stored evidence.
  resolveWithHints?(input: PlaceResolutionInput): Promise<{
    results: ResolvedPlaceCandidate[];
    hints: {latitude: number; longitude: number}[];
  }>;
  // Used only after precise retrieval fails. Returns raw geographic anchors,
  // never renamed businesses or coordinates inferred by the model.
  resolveApproximate?(input: PlaceResolutionInput): Promise<ResolvedPlaceCandidate[]>;
}
