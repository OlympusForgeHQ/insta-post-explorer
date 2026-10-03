import "server-only";

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AUDIT_OPERATIONS, AUDIT_TABLES, type AuditLogPage } from "@/features/library/audit-types";
import { databaseConfigured, prisma } from "@/server/db";
import { parseOwnerId } from "@/server/owner";

const querySchema = z.object({
  cursor: z.string().regex(/^[1-9][0-9]{0,18}$/).transform((value) => BigInt(value)).refine((value) => value <= BigInt("9223372036854775807")).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  table: z.enum(AUDIT_TABLES).optional(),
  operation: z.enum(AUDIT_OPERATIONS).optional(),
});

export async function getAuditLog(owner: string, query: unknown): Promise<AuditLogPage> {
  const ownerId = parseOwnerId(owner);
  const { cursor, limit, table, operation } = querySchema.parse(query);
  if (!databaseConfigured) throw new Error("DATABASE_NOT_CONFIGURED");
  const events = await prisma.auditEvent.findMany({
    where: { ownerId, tableName: table, operation, ...(cursor ? { id: { lt: BigInt(cursor) } } : {}) },
    orderBy: { id: "desc" },
    take: limit + 1,
  });
  return {
    items: events.slice(0, limit).map((event) => ({
      id: event.id.toString(), occurredAt: event.occurredAt.toISOString(), tableName: event.tableName,
      operation: event.operation, recordKey: event.recordKey, beforeData: event.beforeData, afterData: event.afterData,
      databaseUser: event.databaseUser, applicationName: event.applicationName,
      transactionId: event.transactionId.toString(), action: event.action,
    })),
    nextCursor: events.length > limit ? events[limit - 1].id.toString() : null,
  };
}

// Transaction-local settings cannot leak into the next request on a pooled connection.
export async function setAuditAction(transaction: Prisma.TransactionClient, action: string): Promise<void> {
  await transaction.$queryRaw`SELECT set_config('ipe.audit_action', ${action}, true)`;
}
