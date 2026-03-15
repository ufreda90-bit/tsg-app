import { PrismaClient, Prisma } from "@prisma/client";

export type WorkReportContentUpdateRecord = {
  id: string;
  interventionId: number;
  version: number;
  [key: string]: unknown;
};

export type WorkReportContentUpdateTx = {
  workReport: {
    findFirst(args: { where: { interventionId: number } }): Promise<WorkReportContentUpdateRecord | null>;
    updateMany(args: {
      where: { interventionId: number; version: number };
      data: Record<string, unknown> & { version: { increment: number } };
    }): Promise<{ count: number }>;
  };
};

type AcceptableTx = WorkReportContentUpdateTx | Prisma.TransactionClient | PrismaClient;

export async function updateWorkReportContentWithOptimisticLock(params: {
  tx: AcceptableTx;
  interventionId: number;
  providedVersion: unknown;
  data: Record<string, unknown>;
}) {
  const { tx, interventionId, providedVersion, data } = params;
  let normalizedVersion: number;
  if (typeof providedVersion === "number" && Number.isInteger(providedVersion)) {
    normalizedVersion = providedVersion;
  } else if (typeof providedVersion === "string") {
    const trimmed = providedVersion.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw { status: 400, message: "version is required" };
    }
    normalizedVersion = Number(trimmed);
  } else {
    throw { status: 400, message: "version is required" };
  }

  const existing = await (tx as any).workReport.findFirst({ where: { interventionId } });
  if (!existing) {
    throw { status: 404, message: "Work report not found" };
  }

  if (Object.keys(data).length === 0) {
    return existing;
  }

  const result = await (tx as any).workReport.updateMany({
    where: {
      interventionId,
      version: normalizedVersion
    },
    data: {
      ...data,
      version: { increment: 1 }
    }
  });

  if (result.count === 0) {
    const latest = await (tx as any).workReport.findFirst({ where: { interventionId } });
    if (!latest) {
      throw { status: 404, message: "Work report not found" };
    }
    throw { status: 409, message: "Work report was updated by another client. Refresh and retry." };
  }

  const updated = await (tx as any).workReport.findFirst({ where: { interventionId } });
  if (!updated) {
    throw { status: 404, message: "Work report not found" };
  }

  return updated;
}
