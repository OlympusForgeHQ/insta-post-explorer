import "server-only";

import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

import { getSessionConfiguration } from "@/auth/config";
import { getSyncAutomationConfiguration, SyncAutomationUnauthorizedError } from "@/auth/sync-automation";

export const MANUAL_SYNC_TOKEN_SECONDS = 86_400;
export const AUTOMATIC_SYNC_TOKEN_SECONDS = 14_400;

const claimsSchema = z.object({
  sub: z.string().min(1),
  ownerId: z.string().min(1),
  scope: z.literal("instagram-sync"),
  automationKeyId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export async function createSyncToken(
  jobId: string,
  ownerId: string,
  options?: { automationKeyId: string },
): Promise<string> {
  const { secret } = getSessionConfiguration();
  if (options) validateAutomationGeneration(options.automationKeyId, ownerId);
  const lifetime = options ? AUTOMATIC_SYNC_TOKEN_SECONDS : MANUAL_SYNC_TOKEN_SECONDS;
  return new SignJWT({ ownerId, scope: "instagram-sync", ...options })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(jobId)
    .setIssuedAt()
    .setExpirationTime(`${lifetime}s`)
    .sign(secret);
}

export async function verifySyncToken(token: string) {
  const { secret } = getSessionConfiguration();
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
  const claims = claimsSchema.parse(payload);
  if (claims.automationKeyId) validateAutomationGeneration(claims.automationKeyId, claims.ownerId);
  return claims;
}

function validateAutomationGeneration(keyId: string, ownerId: string) {
  const current = getSyncAutomationConfiguration();
  if (keyId !== current.keyId || ownerId !== current.ownerId) {
    throw new SyncAutomationUnauthorizedError();
  }
}
