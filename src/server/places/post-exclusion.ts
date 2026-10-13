import 'server-only';

import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';

export const OWNER_NO_PLACE_REVIEW = 'OWNER_NO_PLACE_REVIEW';

class PostNoPlaceReviewError extends Error {
  readonly code = 'POST_NOT_PLACES_ELIGIBLE';
  constructor() {
    super('POST_NOT_PLACES_ELIGIBLE');
    this.name = 'PostNoPlaceReviewError';
  }
}

// A post-level exclusion is an owner decision, never an automatic inference or
// a place rejection. It deliberately survives input hashes and pipeline versions.
export async function hasOwnerNoPlaceConfirmation(
  ownerId: string,
  postId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  return Boolean(await client.placeEvidence.findFirst({
    where: {
      ownerId, postId, placeId: null, evidenceType: 'USER_CORRECTION',
      AND: [
        { metadata: { path: ['action'], equals: 'POST_NO_PLACE_CONFIRMED' } },
        { metadata: { path: ['actorType'], equals: 'USER' } },
        { metadata: { path: ['actorId'], equals: ownerId } },
      ],
    },
    select: { id: true },
  }));
}

export async function assertPostAllowsPlaceAnalysis(
  ownerId: string,
  postId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<void> {
  // Keep the existing worker API's stable 409 eligibility contract.
  if (await hasOwnerNoPlaceConfirmation(ownerId, postId, client)) {
    throw new PostNoPlaceReviewError();
  }
}
