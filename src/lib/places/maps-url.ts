export type PlaceAddress = {
  displayName: string;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
};

export function googleMapsSearchUrl(place: PlaceAddress): string {
  // A text search preserves approximate locations without inventing a precise pin.
  const parts = [place.address?.trim() || place.displayName.trim(), place.city, place.region, place.country]
    .map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  const query = [...new Set(parts)].join(", ");
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query })}`;
}
