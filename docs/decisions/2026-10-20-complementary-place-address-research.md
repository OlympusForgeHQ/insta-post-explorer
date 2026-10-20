# Complementary place address research

Status: accepted. Owner requested automatic complementary Google/API research
on 20 October 2026. This decision extends the existing Places retrieval pipeline.

## Context

Google can locate a named venue absent from the independent geographic provider's
POI catalog. Its coordinate hints alone cannot establish the business identity
required for a canonical place on the current map.

## Decision

Use the existing OpenRouter account and DeepSeek model with the Exa web-search
plugin for unresolved named businesses with a city and country. This is an
optional server-side resolver stage, not another worker or datastore.

Send only public business and geographic fields. Require literal address evidence
from two distinct source domains, retain the evidence, and independently geocode
the supported address with Geoapify. Google continues supplying only transient
ID/location hints; its business text does not become map data.

Limit research to two requests per analysis job, five search results per request,
a bounded response and deadline, and a durable owner/month request cap (100 by
default). Only an incomplete first search allows a follow-up. Failure retains the
existing geographic fallback. Known multiple sites cannot collapse to one shop.

## Alternatives and consequences

Google-only verification cannot recover missing independent POIs. Fetching
arbitrary business websites introduces redirect/network risks and broken sites.
The selected plugin reuses existing credentials, with no dependency or schema
change, while adding limited latency and cost to otherwise unresolved venues.

Web sources can be stale or incomplete. Identity, explicit geography, postal
codes, units, provider building identity and corroboration remain mandatory.
Automatic research cannot override a manual correction or removal. Disable
`PLACES_WEB_SEARCH_ENABLED` to roll back the optional stage.
