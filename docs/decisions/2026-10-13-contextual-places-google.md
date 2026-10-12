# Contextual identity decisions and Google Places retrieval

Status: accepted by owner request, 13 October 2026.

The owner approves contextual deduction instead of mandatory literal fields or a
global weighted acceptance threshold. Similarities remain useful for retrieval;
identity is decided by matching facts and contradictions, with explicit abstention.

Google Places Text Search (New) is an optional secondary source in the existing
server resolver. It supplements Geoapify for businesses. No additional service,
database, authentication mechanism or model provider is introduced. Only minimal
candidate text is sent; captions and media are not sent to Google. The key remains
server-only. Provider results retain identity and attribution, and do not override
the owner's categories. Google ranking is not interpreted as a match probability.

Confirmed owner Places provide reusable context, not an automatically trained
model. Automatic results never become human-verified examples merely by succeeding.
Existing manual corrections and deletions dominate this path.
