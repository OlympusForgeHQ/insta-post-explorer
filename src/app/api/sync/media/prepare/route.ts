import { NextResponse } from "next/server";
import { z } from "zod";

import { prepareR2Upload } from "@/server/r2";
import { requireSyncToken } from "@/server/sync-auth";
import { withActiveSyncJob } from "@/server/sync-runs";

const bodySchema = z.object({
  authorUsername: z.string(),
  postCode: z.string(),
  position: z.number(),
  carousel: z.boolean(),
  kind: z.enum(["image", "video", "thumbnail"]),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "video/mp4"]),
  byteSize: z.number(),
});

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const claims = await requireSyncToken(request);
    const body = bodySchema.parse(await request.json());
    const prepared = await withActiveSyncJob(claims, () => prepareR2Upload(body));
    return NextResponse.json(prepared, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    return NextResponse.json({ error: message }, { status: message === "SYNC_UNAUTHORIZED" ? 401 : 400 });
  }
}
