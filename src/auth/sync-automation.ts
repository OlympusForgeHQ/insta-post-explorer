import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { getConfiguredOwnerId } from "@/auth/config";

export class SyncAutomationUnauthorizedError extends Error {
  constructor() {
    super("SYNC_AUTOMATION_UNAUTHORIZED");
    this.name = "SyncAutomationUnauthorizedError";
  }
}

export class SyncAutomationUnavailableError extends Error {
  constructor() {
    super("SYNC_AUTOMATION_UNAVAILABLE");
    this.name = "SyncAutomationUnavailableError";
  }
}

export function getSyncAutomationConfiguration() {
  const hash = process.env.INSTAGRAM_AUTO_SYNC_KEY_SHA256?.trim().toLowerCase();
  const readHash = process.env.EXTERNAL_API_KEY_SHA256?.trim().toLowerCase();
  if (process.env.INSTAGRAM_AUTO_SYNC_ENABLED !== "1" ||
      !process.env.APP_OWNER_ID?.trim() ||
      !hash || !/^[a-f0-9]{64}$/.test(hash) || hash === readHash) {
    throw new SyncAutomationUnavailableError();
  }

  try {
    const url = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
    const localDevelopment = process.env.NODE_ENV !== "production" && url.origin === "http://localhost:3000";
    if ((!localDevelopment && url.protocol !== "https:") || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) {
      throw new SyncAutomationUnavailableError();
    }
    const timezone = process.env.INSTAGRAM_AUTO_SYNC_TIMEZONE?.trim() || "Europe/Brussels";
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date());
    const datePart = (name: string) => parts.find((part) => part.type === name)!.value;
    return {
      hash,
      // Derive a public generation identifier without exposing the key digest.
      keyId: createHash("sha256").update(`instagram-sync-generation:${hash}`).digest("hex"),
      ownerId: getConfiguredOwnerId(),
      apiBaseUrl: url.origin,
      timezone,
      localDay: `${datePart("year")}-${datePart("month")}-${datePart("day")}`,
    };
  } catch {
    throw new SyncAutomationUnavailableError();
  }
}

export function requireSyncAutomationKey(request: Request) {
  const configuration = getSyncAutomationConfiguration();
  const match = /^Bearer\s+(ips_sync_[A-Za-z0-9_-]{43})$/i.exec(
    request.headers.get("authorization")?.trim() ?? "",
  );
  if (!match || !timingSafeEqual(
    createHash("sha256").update(match[1]).digest(),
    Buffer.from(configuration.hash, "hex"),
  )) {
    throw new SyncAutomationUnauthorizedError();
  }
  return {
    ownerId: configuration.ownerId,
    keyId: configuration.keyId,
    apiBaseUrl: configuration.apiBaseUrl,
  };
}
