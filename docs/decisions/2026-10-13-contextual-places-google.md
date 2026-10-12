# Contextual identity decisions and Google Places retrieval

Status: accepted by owner request, 13 October 2026.

The owner approves contextual deduction instead of mandatory literal fields or a
global weighted acceptance threshold. Similarities remain useful for retrieval;
identity is decided by matching facts and contradictions, with explicit abstention.

Google Places Text Search (New) is an optional secondary source in the existing
server resolver. It supplements Geoapify for businesses. No additional service,
database, authentication mechanism or model provider is introduced. Only minimal
candidate text is sent; captions and media are not sent to Google. The key remains
server-only. Google supplies transient ID/location hints only; Geoapify is re-queried near
those hints using the original candidate. Only independently verified Geoapify
identity, attribution and coordinates are persisted. Google records cannot reach
canonical rows, job decisions or confirmed memory. No Google text is requested,
and ranking is not interpreted as a match probability. This preserves the former
Google helper's contract and avoids a permanent Google-content cache on MapLibre.
See [Places storage policy](https://developers.google.com/maps/documentation/places/web-service/policies)
and [EEA service terms, section 15](https://cloud.google.com/terms/maps-platform/eea/maps-service-terms).

Confirmed owner Places provide reusable context, not an automatically trained
model. Automatic results never become human-verified examples merely by succeeding.
Existing manual corrections and deletions dominate this path.
