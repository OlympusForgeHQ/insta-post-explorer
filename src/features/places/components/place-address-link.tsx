import { ExternalLink } from "lucide-react";
import { googleMapsSearchUrl, type PlaceAddress } from "@/lib/places/maps-url";

export function PlaceAddressLink({ place }: { place: PlaceAddress }) {
  const label = place.address?.trim()
    || [...new Set([place.displayName, place.city, place.region, place.country].filter(Boolean))].join(", ");
  return (
    <a className="place-address-link" href={googleMapsSearchUrl(place)} target="_blank" rel="noopener noreferrer"
      aria-label={`Ouvrir ${label} dans Google Maps`}>
      <span>{label}</span><ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}
