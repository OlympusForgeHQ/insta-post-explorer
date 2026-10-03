import { instagramPostCode } from "@/lib/import/normalize";

export type SyncKnownPost = {
  externalId: string | null;
  postCode: string | null;
};

export function buildSyncKnownPosts(
  posts: Array<{ externalId: string | null; postUrl: string }>,
): SyncKnownPost[] {
  return posts.map((post) => ({ externalId: post.externalId, postCode: instagramPostCode(post.postUrl) }));
}
