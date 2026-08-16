import { db } from "@/lib/db";
import type {
  ActivityAction,
  ActivityEntityType,
  Prisma,
} from "@/generated/prisma/client";

export type RecordActivityInput = {
  organizationId: string;
  actorId?: string | null;
  action: ActivityAction;
  entityType: ActivityEntityType;
  entityId: string;
  summary: string;
  metadata?: Prisma.InputJsonValue;
  /** Optional transaction client */
  tx?: Prisma.TransactionClient;
};

/**
 * Append-only activity log write. Never logs secrets or full sensitive payloads.
 */
export async function recordActivity(
  input: RecordActivityInput
): Promise<{ id: string }> {
  const client = input.tx ?? db;
  const row = await client.activityLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary.slice(0, 500),
      metadata: input.metadata ?? undefined,
    },
    select: { id: true },
  });
  return row;
}
