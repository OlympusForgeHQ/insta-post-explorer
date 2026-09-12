import "server-only";

import { AUTOMATIC_SYNC_TOKEN_SECONDS, createSyncToken, MANUAL_SYNC_TOKEN_SECONDS } from "@/auth/sync-token";
import { buildSyncKnownPosts } from "@/server/sync-session";
import { getSyncAutomationConfiguration } from "@/auth/sync-automation";
import { admitSyncRun, SYNC_HEARTBEAT_SECONDS, SYNC_LEASE_MS, withSyncOwnerLock } from "@/server/sync-runs";

export async function createSyncSession(input: {
  ownerId: string;
  apiBaseUrl: string;
  automationKeyId?: string;
}) {
  return withSyncOwnerLock(input.ownerId, async (tx) => {
    const options = input.automationKeyId ? { automationKeyId: input.automationKeyId } : undefined;
    const automationDay = options ? getSyncAutomationConfiguration().localDay : null;
    await admitSyncRun(tx, input.ownerId, automationDay);
    const knownPosts = await tx.post.findMany({
      where: { ownerId: input.ownerId },
      select: { externalId: true, postUrl: true },
      orderBy: [
        { publishedAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: 10_000,
    });
    const identities = buildSyncKnownPosts(knownPosts);
    const lifetime = options ? AUTOMATIC_SYNC_TOKEN_SECONDS : MANUAL_SYNC_TOKEN_SECONDS;
    const job = await tx.syncJob.create({ data: {
      ownerId: input.ownerId, automationDay,
      leaseExpiresAt: new Date(Date.now() + SYNC_LEASE_MS),
      runExpiresAt: new Date(Date.now() + lifetime * 1000),
    } });
    return {
      jobId: job.id,
      token: await createSyncToken(job.id, input.ownerId, options),
      apiBaseUrl: input.apiBaseUrl,
      knownExternalIds: identities.flatMap((post) => post.externalId ? [post.externalId] : []),
      knownPostCodes: identities.flatMap((post) => post.postCode ? [post.postCode] : []),
      knownPosts: identities,
      expiresInSeconds: lifetime,
      heartbeatIntervalSeconds: SYNC_HEARTBEAT_SECONDS,
    };
  });
}
