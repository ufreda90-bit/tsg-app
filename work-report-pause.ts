import {
  nonNegativeInt,
  safeFloorMinutesBetween
} from "./work-report-timing.ts";

export type PauseWorkReportRecord = {
  id: string;
  interventionId: number;
  version: number;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  pauseStartAt: Date | null;
  pausedMinutes: number;
  [key: string]: unknown;
};

export type PauseWorkReportTx = {
  workReport: {
    findFirst(args: { where: { interventionId: number; organizationId: number } }): Promise<PauseWorkReportRecord | null>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
};

const TIMING_CONFLICT_MESSAGE = "Work report was updated by another client. Refresh and retry.";

function ensurePauseStartPreconditions(current: PauseWorkReportRecord | null) {
  if (!current) {
    throw { status: 404, message: "Work report not found" };
  }
  if (current.actualEndAt) {
    throw { status: 409, message: "Cannot start pause on a stopped work report" };
  }
}

function ensurePauseStopPreconditions(current: PauseWorkReportRecord | null) {
  if (!current) {
    throw { status: 404, message: "Work report not found" };
  }
}

function isNoopPauseStartState(current: PauseWorkReportRecord | null) {
  return !!current && !!current.pauseStartAt && !current.actualEndAt;
}

function isNoopPauseStopState(current: PauseWorkReportRecord | null) {
  return !!current && (!current.pauseStartAt || !!current.actualEndAt);
}

function normalizedPausedMinutes(value: unknown) {
  return nonNegativeInt(value);
}

function computeOpenPauseMinutesInt(now: Date, pauseStartAt: Date) {
  return safeFloorMinutesBetween(pauseStartAt, now);
}

function buildPauseStartData(current: PauseWorkReportRecord, now: Date) {
  const data: Record<string, unknown> = {
    pauseStartAt: now,
    pausedMinutes: normalizedPausedMinutes(current.pausedMinutes)
  };
  if (!current.actualStartAt) {
    data.actualStartAt = now;
    data.clientStartAt = now;
    data.actualMinutes = 0;
  }
  return data;
}

export async function pauseStartWorkReportInTransaction(params: {
  tx: PauseWorkReportTx;
  interventionId: number;
  organizationId: number;
  now: Date;
}) {
  const { tx, interventionId, organizationId, now } = params;

  const current = await tx.workReport.findFirst({ where: { interventionId, organizationId } });
  ensurePauseStartPreconditions(current);

  if (isNoopPauseStartState(current)) {
    return current;
  }

  const result = await tx.workReport.updateMany({
    where: {
      interventionId,
      organizationId,
      version: current.version,
      actualEndAt: null,
      pauseStartAt: null
    },
    data: {
      ...buildPauseStartData(current, now),
      version: { increment: 1 }
    }
  });

  if (result.count === 1) {
    const updated = await tx.workReport.findFirst({ where: { interventionId, organizationId } });
    if (!updated) {
      throw { status: 404, message: "Work report not found" };
    }
    return updated;
  }

  const latest = await tx.workReport.findFirst({ where: { interventionId, organizationId } });
  ensurePauseStartPreconditions(latest);
  if (isNoopPauseStartState(latest)) {
    return latest;
  }
  throw { status: 409, message: TIMING_CONFLICT_MESSAGE };
}

export async function pauseStopWorkReportInTransaction(params: {
  tx: PauseWorkReportTx;
  interventionId: number;
  organizationId: number;
  now: Date;
}) {
  const { tx, interventionId, organizationId, now } = params;

  const current = await tx.workReport.findFirst({ where: { interventionId, organizationId } });
  ensurePauseStopPreconditions(current);

  if (isNoopPauseStopState(current)) {
    return current;
  }

  const openPauseMinutesInt = computeOpenPauseMinutesInt(now, current.pauseStartAt);
  const nextPausedMinutes = normalizedPausedMinutes(current.pausedMinutes) + openPauseMinutesInt;

  const result = await tx.workReport.updateMany({
    where: {
      interventionId,
      organizationId,
      version: current.version,
      actualEndAt: null,
      pauseStartAt: current.pauseStartAt
    },
    data: {
      pausedMinutes: nextPausedMinutes,
      pauseStartAt: null,
      version: { increment: 1 }
    }
  });

  if (result.count === 1) {
    const updated = await tx.workReport.findFirst({ where: { interventionId, organizationId } });
    if (!updated) {
      throw { status: 404, message: "Work report not found" };
    }
    return updated;
  }

  const latest = await tx.workReport.findFirst({ where: { interventionId, organizationId } });
  ensurePauseStopPreconditions(latest);
  if (isNoopPauseStopState(latest)) {
    return latest;
  }
  throw { status: 409, message: TIMING_CONFLICT_MESSAGE };
}
