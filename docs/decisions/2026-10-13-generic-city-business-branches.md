# Generic business recommendations within a city

Status: accepted by the owner on 13 October 2026; implementation independently reviewed.

When a post recommends a named business generically in a named city, without a
street address, neighborhood or other branch discriminator, retain every
independently verified shop of that business in that city. Explicit wording such as “multiple locations” is
not required for this case.

A recommendation scoped to a neighborhood, street, station, landmark or named
branch remains specific even if its structured address is absent. Missing
information and knowledge that an entity is a chain do not establish generic
city intent. Uncertain scope remains subject to existing branch ambiguity rules.

The model extracts textual scope from the complete supplied source context. The
application validates its evidence and the geographic provider establishes the
actual branch identities and coordinates. Source excerpts remain immutable.
Historical results do not acquire city scope automatically; any separate owner
review of historical candidates retains its own original-source audit.

This decision adds no service, schema migration, schedule or automatic replay.
