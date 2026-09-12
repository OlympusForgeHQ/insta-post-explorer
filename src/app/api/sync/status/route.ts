import { NextResponse } from "next/server";
import { requireSyncToken } from "@/server/sync-auth";
import { getSyncJobStatus } from "@/server/sync-runs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getSyncJobStatus(await requireSyncToken(request)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const denied = error instanceof Error && error.message === "SYNC_UNAUTHORIZED";
    return NextResponse.json({ error: denied ? "SYNC_UNAUTHORIZED" : "INTERNAL_ERROR" }, {
      status: denied ? 401 : 500, headers: { "Cache-Control": "no-store" },
    });
  }
}
