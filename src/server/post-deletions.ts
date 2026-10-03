import "server-only";

import type { Prisma } from "@prisma/client";

import { instagramPostCode } from "@/lib/import/normalize";

type PostIdentity = { postUrl: string; externalId: string | null };

export async function findPostAliases(transaction: Prisma.TransactionClient, ownerId: string, postId: string) {
  // Legacy rows may pair only one identity. Resolve the connected aliases so
  // deleting a URL-only row also follows an external ID learned from its alias.
  const posts = await transaction.post.findMany({
    where: { ownerId },
    select: { id: true, postUrl: true, externalId: true },
  });
  const selected = posts.find((post) => post.id === postId);
  if (!selected) return [];
  const byIdentity = new Map<string, typeof posts>();
  for (const post of posts) {
    for (const key of identityKeys(post)) {
      const group = byIdentity.get(key) ?? [];
      group.push(post);
      byIdentity.set(key, group);
    }
  }
  const matched = [selected];
  const seen = new Set([selected.id]);
  for (let index = 0; index < matched.length; index++) {
    for (const key of identityKeys(matched[index])) {
      for (const alias of byIdentity.get(key) ?? []) {
        if (!seen.has(alias.id)) {
          seen.add(alias.id);
          matched.push(alias);
        }
      }
      byIdentity.delete(key);
    }
  }
  return matched;
}

function identityKeys(post: PostIdentity): string[] {
  const code = instagramPostCode(post.postUrl);
  return [
    `url:${post.postUrl}`,
    ...(post.externalId ? [`id:${post.externalId}`] : []),
    ...(code ? [`code:${code}`] : []),
  ];
}

export async function lockPostWrites(transaction: Prisma.TransactionClient, ownerId: string): Promise<void> {
  // Import's absence check and delete's marker must share a lock even when no
  // Post row exists. Sync takes its run lock before acquiring this write lock.
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`post-writes:${ownerId}`}, 0))::text`;
}

export async function excludeDeletedPosts<T extends PostIdentity>(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  posts: T[],
): Promise<T[]> {
  const identities = posts.map((post) => ({ ...post, postCode: instagramPostCode(post.postUrl) }));
  const deleted = await transaction.deletedPost.findMany({
    where: {
      ownerId,
      OR: [
        { postUrl: { in: identities.map((post) => post.postUrl) } },
        { externalId: { in: identities.flatMap((post) => post.externalId ? [post.externalId] : []) } },
        { postCode: { in: identities.flatMap((post) => post.postCode ? [post.postCode] : []) } },
      ],
    },
    select: { postUrl: true, externalId: true, postCode: true },
  });
  const urls = new Set(deleted.map((post) => post.postUrl));
  const externalIds = new Set(deleted.flatMap((post) => post.externalId ? [post.externalId] : []));
  const codes = new Set(deleted.flatMap((post) => post.postCode ? [post.postCode] : []));
  return posts.filter((post, index) =>
    !urls.has(post.postUrl) &&
    !(post.externalId && externalIds.has(post.externalId)) &&
    !codes.has(identities[index].postCode ?? ""),
  );
}
