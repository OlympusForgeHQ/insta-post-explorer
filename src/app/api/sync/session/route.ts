import { NextResponse } from "next/server";

import { authErrorResponse } from "@/auth/http";
import { AuthConfigurationError } from "@/auth/config";
import { requireSession, UnauthorizedError } from "@/auth/session";
import { createSyncSession } from "@/server/create-sync-session";
import { SyncAdmissionError } from "@/server/sync-runs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const result = await createSyncSession({
      ownerId: session.ownerId,
      apiBaseUrl: new URL(request.url).origin,
    });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SyncAdmissionError) {
      return NextResponse.json({ error: error.code }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    const response = error instanceof UnauthorizedError || error instanceof AuthConfigurationError
      ? authErrorResponse(error)
      : NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
