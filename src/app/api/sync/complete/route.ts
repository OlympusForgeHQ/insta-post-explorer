import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSyncToken } from "@/server/sync-auth";
import { completeSyncJob } from "@/server/sync-runs";

const bodySchema = z.object({
  status: z.enum(["completed", "failed"]),
  error: z.string().max(255).nullable().optional(),
  mediaFailed: z.number().int().nonnegative().default(0),
});

export async function POST(request: Request) {
  try {
    const claims = await requireSyncToken(request);
    const body = bodySchema.parse(await request.json());
    const status = await completeSyncJob(claims, body);
    return NextResponse.json({ ok: true, status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    return NextResponse.json({ error: message }, { status: message === "SYNC_UNAUTHORIZED" ? 401 : 400 });
  }
}
