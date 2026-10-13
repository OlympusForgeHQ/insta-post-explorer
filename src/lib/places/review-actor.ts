import { z } from "zod";

// Strict, bounded actor and context contract for internal Places review
// mutations. It captures only who acted and a bounded human reason — never a
// token, OAuth address, secret, or full session payload.

export const PLACE_REVIEW_ACTOR_TYPES = ["USER", "ADMIN", "SYSTEM", "MCP"] as const;
export type PlaceReviewActorType = (typeof PLACE_REVIEW_ACTOR_TYPES)[number];

export const PLACE_REVIEW_ACTIONS = [
  "PLACE_CONFIRMED",
  "POST_NO_PLACE_CONFIRMED",
  "PLACE_REJECTED",
  "POST_PLACE_CORRECTED",
  "PLACES_MERGED",
] as const;
export type PlaceReviewAction = (typeof PLACE_REVIEW_ACTIONS)[number];

export const REVIEW_REASON_MAX_LENGTH = 500;
const ACTOR_ID_MAX_LENGTH = 200;

export const placeReviewActorSchema = z
  .object({
    type: z.enum(PLACE_REVIEW_ACTOR_TYPES),
    id: z.string().trim().min(1).max(ACTOR_ID_MAX_LENGTH),
  })
  .strict();

export const placeReviewContextSchema = z
  .object({
    actor: placeReviewActorSchema,
    reason: z.string().trim().min(1).max(REVIEW_REASON_MAX_LENGTH),
  })
  .strict();

export type PlaceReviewActor = z.infer<typeof placeReviewActorSchema>;
export type PlaceReviewContext = z.infer<typeof placeReviewContextSchema>;

export type PlaceReviewAuditMetadata = {
  action: PlaceReviewAction;
  actorType: PlaceReviewActorType;
  actorId: string;
};

// Bounded, non-sensitive audit metadata stored on a USER_CORRECTION evidence
// row. Only the action and the actor identity are recorded.
export function buildAuditMetadata(action: PlaceReviewAction, actor: PlaceReviewActor): PlaceReviewAuditMetadata {
  return { action, actorType: actor.type, actorId: actor.id };
}
