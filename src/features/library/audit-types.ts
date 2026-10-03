import type { Prisma } from "@prisma/client";

export const AUDIT_TABLES = [
  "posts", "deleted_posts", "collections", "collection_posts", "post_media", "tags", "post_tags",
  "import_jobs", "sync_jobs", "places", "post_places", "place_evidence", "place_analysis_jobs",
] as const;
export const AUDIT_OPERATIONS = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"] as const;
export const AUDIT_TABLE_LABELS: Record<string, string> = {
  posts: "Publications", deleted_posts: "Suppressions définitives", collections: "Collections",
  collection_posts: "Publications des collections", post_media: "Médias", tags: "Tags", post_tags: "Tags des publications",
  import_jobs: "Imports", sync_jobs: "Synchronisations", places: "Lieux", post_places: "Lieux des publications",
  place_evidence: "Indices des lieux", place_analysis_jobs: "Analyses des lieux",
};
export const AUDIT_OPERATION_LABELS: Record<string, string> = {
  INSERT: "Création", UPDATE: "Modification", DELETE: "Suppression", TRUNCATE: "Vidage",
};

export type AuditLogItem = {
  id: string;
  occurredAt: string;
  tableName: string;
  operation: string;
  recordKey: Prisma.JsonValue;
  beforeData: Prisma.JsonValue;
  afterData: Prisma.JsonValue;
  databaseUser: string;
  applicationName: string;
  transactionId: string;
  action: string | null;
};
export type AuditLogPage = { items: AuditLogItem[]; nextCursor: string | null };
