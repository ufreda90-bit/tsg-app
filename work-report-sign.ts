import { PrismaClient, Prisma } from "@prisma/client";

export type PublicSignWorkReportRecord = {
  id: string;
  signatureToken: string | null;
  signatureRequestedAt: Date | null;
  signedAt: Date | null;
  customerSignatureDataUrl: string | null;
  customerName?: string | null;
  [key: string]: unknown;
};

export type PublicSignTx = {
  workReport: {
    findUnique(args: Record<string, unknown>): Promise<PublicSignWorkReportRecord | null>;
    updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
  };
};

type AcceptableTx = PublicSignTx | Prisma.TransactionClient | PrismaClient;

const consumedSignTokens = new Map<string, number>();

function ttlMsFromHours(ttlHours: number) {
  const safeTtlHours = Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : 168;
  return safeTtlHours * 60 * 60 * 1000;
}

function pruneConsumedTokens(nowMs: number, ttlHours: number) {
  const ttlMs = ttlMsFromHours(ttlHours);
  for (const [token, signedAtMs] of consumedSignTokens.entries()) {
    if (nowMs - signedAtMs > ttlMs) {
      consumedSignTokens.delete(token);
    }
  }
}

function markConsumedToken(token: string, now: Date) {
  consumedSignTokens.set(token, now.getTime());
}

function wasTokenRecentlyConsumed(token: string, now: Date, ttlHours: number) {
  pruneConsumedTokens(now.getTime(), ttlHours);
  const consumedAtMs = consumedSignTokens.get(token);
  if (consumedAtMs == null) return false;
  if (now.getTime() - consumedAtMs > ttlMsFromHours(ttlHours)) {
    consumedSignTokens.delete(token);
    return false;
  }
  return true;
}

export function isTokenExpired(signatureRequestedAt: Date | null, now: Date, ttlHours: number): boolean {
  if (!signatureRequestedAt) return true;
  return now.getTime() - signatureRequestedAt.getTime() > ttlMsFromHours(ttlHours);
}

export async function getPublicSignWorkReportByTokenOrThrow(params: {
  tx: AcceptableTx;
  token: string;
  now: Date;
  ttlHours: number;
  includeIntervention?: boolean;
}) {
  const { tx, token, now, ttlHours, includeIntervention } = params;
  const report = await (tx as any).workReport.findUnique({
    where: { signatureToken: token },
    ...(includeIntervention ? { include: { intervention: true } } : {})
  });

  if (!report || isTokenExpired(report.signatureRequestedAt, now, ttlHours)) {
    throw { status: 404, message: "Link non valido o scaduto" };
  }

  return report;
}

export async function signWorkReportByTokenInTransaction(params: {
  tx: AcceptableTx;
  token: string;
  now: Date;
  signatureDataUrl: string;
  customerName?: string;
  ttlHours: number;
}) {
  const { tx, token, now, signatureDataUrl, customerName, ttlHours } = params;

  if (wasTokenRecentlyConsumed(token, now, ttlHours)) {
    throw { status: 409, message: "Bolla già firmata" };
  }

  const minRequestedAt = new Date(now.getTime() - ttlMsFromHours(ttlHours));
  const updateData: Record<string, unknown> = {
    customerSignatureDataUrl: signatureDataUrl,
    signedAt: now,
    signatureToken: null
  };
  if (customerName) {
    updateData.customerName = customerName;
  }

  const result = await (tx as any).workReport.updateMany({
    where: {
      signatureToken: token,
      signedAt: null,
      signatureRequestedAt: { gte: minRequestedAt }
    },
    data: updateData
  });

  if (result.count === 1) {
    markConsumedToken(token, now);
    return { ok: true };
  }

  const report = await (tx as any).workReport.findUnique({
    where: { signatureToken: token }
  });

  if (!report) {
    if (wasTokenRecentlyConsumed(token, now, ttlHours)) {
      throw { status: 409, message: "Bolla già firmata" };
    }
    throw { status: 404, message: "Link non valido o scaduto" };
  }

  if (isTokenExpired(report.signatureRequestedAt, now, ttlHours)) {
    throw { status: 404, message: "Link non valido o scaduto" };
  }

  if (report.signedAt) {
    throw { status: 409, message: "Bolla già firmata" };
  }

  throw { status: 404, message: "Link non valido o scaduto" };
}

