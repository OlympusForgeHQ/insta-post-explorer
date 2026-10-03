import { NextResponse } from "next/server";
import { requireSession } from "@/auth/session";
import { getAuditLog } from "@/server/audit-log";
import { adminApiErrorResponse } from "@/server/admin-http";

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return NextResponse.json(await getAuditLog(session.ownerId, query), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminApiErrorResponse(error);
  }
}
