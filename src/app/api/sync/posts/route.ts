import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSyncToken } from "@/server/sync-auth";
import { importSyncedPost, syncPostSchema } from "@/server/sync-post";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const claims = await requireSyncToken(request);
    const post = syncPostSchema.parse(await request.json());
    return NextResponse.json(await importSyncedPost(claims, post), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "SYNC_UNAUTHORIZED") {
      return NextResponse.json({ error: "SYNC_UNAUTHORIZED" }, { status: 401 });
    }
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
    return NextResponse.json({ error: invalid ? "SYNC_INVALID_POST" : "SYNC_IMPORT_FAILED" }, { status: invalid ? 400 : 500 });
  }
}
