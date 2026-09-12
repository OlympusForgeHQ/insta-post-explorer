import { NextResponse } from "next/server";
import { z } from "zod";

import { ExternalApiUnauthorizedError, ExternalApiUnavailableError } from "@/auth/api-key";
import { PlacesCursorError } from "@/lib/places/cursor";

// Stable error contract for /api/v1. External responses never leak stack
// traces, SQL, Prisma internals, environment values, or auth details.
export type ExternalApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "SYNC_IN_PROGRESS"
  | "SYNC_ALREADY_COMPLETED"
  | "SYNC_DAILY_LIMIT"
  | "SERVICE_UNAVAILABLE";

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization",
};

// A requested resource does not exist for the configured owner.
export class ExternalApiNotFoundError extends Error {
  constructor() {
    super("EXTERNAL_API_NOT_FOUND");
    this.name = "ExternalApiNotFoundError";
  }
}

// Success response with the V1 security headers applied.
export function externalApiJson(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: { ...SECURITY_HEADERS, ...init?.headers },
  });
}

export function externalApiError(
  code: ExternalApiErrorCode,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers: SECURITY_HEADERS });
}

// Map any thrown error to a stable V1 error response. Unknown errors collapse to
// a generic 500 so no internal detail is exposed.
export function externalApiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ExternalApiUnauthorizedError) {
    return externalApiError("UNAUTHORIZED", "Invalid or missing API key", 401);
  }
  if (error instanceof ExternalApiUnavailableError) {
    return externalApiError("SERVICE_UNAVAILABLE", "External API is not configured", 503);
  }
  if (error instanceof ExternalApiNotFoundError) {
    return externalApiError("NOT_FOUND", "Resource not found", 404);
  }
  if (error instanceof PlacesCursorError) {
    return externalApiError("BAD_REQUEST", "Invalid cursor", 400);
  }
  if (error instanceof z.ZodError) {
    return externalApiError("BAD_REQUEST", "Invalid request parameters", 400);
  }
  if (error instanceof Error && error.message === "DATABASE_NOT_CONFIGURED") {
    return externalApiError("SERVICE_UNAVAILABLE", "Service temporarily unavailable", 503);
  }
  return externalApiError("INTERNAL_ERROR", "Internal server error", 500);
}
