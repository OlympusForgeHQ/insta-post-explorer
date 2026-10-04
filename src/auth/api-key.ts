import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

// External read-only API authentication for /api/v1.
// One high-entropy Bearer key: `Authorization: Bearer ipe_<secret>`.
// The server stores only the SHA-256 hash (EXTERNAL_API_KEY_SHA256) and never
// the raw key. The raw token is never logged.

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/;

// The provided key does not match the configured hash, or the header is
// missing/malformed.
export class ExternalApiUnauthorizedError extends Error {
  constructor() {
    super("EXTERNAL_API_UNAUTHORIZED");
    this.name = "ExternalApiUnauthorizedError";
  }
}

// The external API is not configured (missing or invalid key hash). We fail
// closed: no request is served until a valid hash is present.
export class ExternalApiUnavailableError extends Error {
  constructor() {
    super("EXTERNAL_API_UNAVAILABLE");
    this.name = "ExternalApiUnavailableError";
  }
}

export function requireExternalApiKey(request: Request, scope: "read" | "places-worker" = "read"): void {
  const expectedHash = (scope === "places-worker" ? process.env.PLACES_WORKER_API_KEY_SHA256 : process.env.EXTERNAL_API_KEY_SHA256)?.trim().toLowerCase();
  if (scope === "places-worker" && (process.env.PLACES_WORKER_ENABLED !== "1" ||
      [process.env.EXTERNAL_API_KEY_SHA256, process.env.INSTAGRAM_AUTO_SYNC_KEY_SHA256]
        .some(value => value?.trim().toLowerCase() === expectedHash))) throw new ExternalApiUnavailableError();
  if (!expectedHash || !SHA256_HEX.test(expectedHash)) {
    // Fail closed when the key hash is absent or malformed.
    throw new ExternalApiUnavailableError();
  }

  const match = BEARER_PATTERN.exec(request.headers.get("authorization") ?? "");
  const token = match?.[1]?.trim();
  if (!token) throw new ExternalApiUnauthorizedError();

  const providedDigest = createHash("sha256").update(token).digest();
  const expectedDigest = Buffer.from(expectedHash, "hex");
  if (
    providedDigest.length !== expectedDigest.length ||
    !timingSafeEqual(providedDigest, expectedDigest)
  ) {
    throw new ExternalApiUnauthorizedError();
  }
}
