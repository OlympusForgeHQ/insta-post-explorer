import "server-only";

import { verifySyncToken } from "@/auth/sync-token";

export async function requireSyncToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("SYNC_UNAUTHORIZED");
  try {
    return await verifySyncToken(authorization.slice(7));
  } catch {
    // Invalid, expired and revoked run tokens share the same public error.
    throw new Error("SYNC_UNAUTHORIZED");
  }
}
