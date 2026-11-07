import { NextResponse } from "next/server";

import { getConfiguredOwnerId } from "@/auth/config";
import { AdminResourceNotFoundError } from "@/server/admin-library";
import { FavoriteCollectionUnavailableError, setPostFavorite } from "@/server/collections";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const noStore = { "Cache-Control": "no-store" };

function rejectOrigin(request: Request): NextResponse | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const production = process.env.NODE_ENV === "production";
  let canonical: URL;
  try {
    if (!configured && production) throw new Error();
    canonical = new URL(configured || request.url);
    if (!["http:", "https:"].includes(canonical.protocol) || canonical.username || canonical.password
      || (production && canonical.protocol !== "https:")) throw new Error();
  } catch {
    return NextResponse.json({ error: "SITE_UNAVAILABLE" }, { status: 503, headers: noStore });
  }

  const origin = request.headers.get("origin");
  try {
    if (!origin || request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") throw new Error();
    const browserOrigin = new URL(origin);
    // Origin is a serialized origin, never a URL with credentials or a path.
    if (browserOrigin.origin !== origin || browserOrigin.origin !== canonical.origin) throw new Error();
  } catch {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers: noStore });
  }
  return null;
}

async function mutate(request: Request, context: Context, included: boolean): Promise<NextResponse> {
  const rejection = rejectOrigin(request);
  if (rejection) return rejection;
  try {
    const { id } = await context.params;
    const result = await setPostFavorite(getConfiguredOwnerId(), id, included);
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    if (error instanceof AdminResourceNotFoundError) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: noStore });
    }
    if (error instanceof FavoriteCollectionUnavailableError) {
      return NextResponse.json({ error: "FAVORITES_UNAVAILABLE" }, { status: 409, headers: noStore });
    }
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}

export async function PUT(request: Request, context: Context) { return mutate(request, context, true); }
export async function DELETE(request: Request, context: Context) { return mutate(request, context, false); }
