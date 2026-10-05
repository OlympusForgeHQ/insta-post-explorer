import "server-only";

import { Prisma } from "@prisma/client";

// Canonical Places and evidence survive unlinking. Active reads require an
// owner-owned post or manual confirmation, without rechecking the post's theme.
// The status alternative preserves legacy confirmations without the flag.
export function presentPlaceWhere(ownerId: string): Prisma.PlaceWhereInput {
  return {
    ownerId,
    OR: [
      { isUserConfirmed: true },
      { reviewStatus: "CONFIRMED" },
      { postLinks: { some: { ownerId, post: { ownerId } } } },
    ],
  };
}

export function activePlaceWhere(ownerId: string): Prisma.PlaceWhereInput {
  return { ...presentPlaceWhere(ownerId), reviewStatus: { not: "REJECTED" } };
}

// SQL counterpart of activePlaceWhere. Statistics always use the fixed "p"
// alias, so no caller-controlled identifier is interpolated.
export function activePlaceSql(ownerId: string): Prisma.Sql {
  return Prisma.sql`p.owner_id = ${ownerId}
    AND p.review_status <> 'REJECTED'
    AND (
      p.is_user_confirmed = TRUE
      OR p.review_status = 'CONFIRMED'
      OR EXISTS (
        SELECT 1 FROM post_places active_link
        JOIN posts active_post ON active_post.id = active_link.post_id
          AND active_post.owner_id = active_link.owner_id
        WHERE active_link.place_id = p.id AND active_link.owner_id = p.owner_id
      )
    )`;
}
