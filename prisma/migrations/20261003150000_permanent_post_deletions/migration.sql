-- Deletion identities must survive the post and all cascading associations.
CREATE TABLE "deleted_posts" (
  "owner_id" TEXT NOT NULL,
  "post_url" TEXT NOT NULL,
  "external_id" TEXT,
  "post_code" TEXT,
  "deleted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deleted_posts_pkey" PRIMARY KEY ("owner_id", "post_url")
);

CREATE INDEX "deleted_posts_owner_external_id_idx"
  ON "deleted_posts" ("owner_id", "external_id");
CREATE INDEX "deleted_posts_owner_post_code_idx"
  ON "deleted_posts" ("owner_id", "post_code");
