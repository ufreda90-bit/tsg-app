import { InterventionStatus } from "@prisma/client";
import {
  computeStopTimingFromMilliseconds,
  nonNegativeInt
} from "./work-report-timing.ts";

const TERMINAL_INTERVENTION_STATUSES = new Set<InterventionStatus>([
  InterventionStatus.COMPLETED,
  InterventionStatus.CANCELLED,
  InterventionStatus.FAILED,
  InterventionStatus.NO_SHOW
]);

export type StopWorkReportRecord = {
  id: string;
  interventionId: number;
  version: number;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  pauseStartAt: Date | null;
  pausedMinutes: number;
  actualMinutes: number;
  workPerformed: string;
  [key: string]: unknown;
};

export type StopInterventionRecord = {
  id: number;
  version: number;
  status: InterventionStatus;
};

export type StopWorkReportTx = {
  intervention: {
    findUnique(args: { where: { id: number } }): Promise<StopInterventionRecord | null>;
    update(args: {
      where: { id: number };
      data: { status?: InterventionStatus; version: { increment: number } };
    }): Promise<unknown>;
  };
  workReport: {
    findUnique(args: { where: { interventionId: number } }): Promise<StopWorkReportRecord | null>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
};

const TIMING_CONFLICT_MESSAGE = "Work report was updated by another client. Refresh and retry.";

export function computeStoppedWorkReportMinutes(params: {
  actualStartAt: Date;
  actualEndAt: Date;
  pausedMinutes: number;
  pauseStartAt: Date | null;
}) {
  const timing = computeStopTimingFromMilliseconds({
    actualStartAt: params.actualStartAt,
    actualEndAt: params.actualEndAt,
    pausedMinutesIntSoFar: params.pausedMinutes,
    openPauseStartAt: params.pauseStartAt
  });

  return {
    actualMinutes: timing.actualMinutesInt,
    openPauseMinutesInt: timing.openPauseMinutesInt,
    pausedMinutes: timing.pausedMinutesIntTotal,
    totalMinutes: timing.totalElapsedFloorMinutes,
    workedMs: timing.workedMs,
    pausedMsTotal: timing.pausedMsTotal,
    elapsedMs: timing.elapsedMs
  };
}

export async function stopWorkReportInTransaction(params: {
  tx: StopWorkReportTx;
  interventionId: number;
  now: Date;
  notes?: unknown;
}) {
  const { tx, interventionId, now, notes } = params;

  const intervention = await tx.intervention.findUnique({ where: { id: interventionId } });
  if (!intervention) {
    throw { status: 404, message: "Intervento non trovato" };
  }

  const current = await tx.workReport.findUnique({ where: { interventionId } });
  if (!current) {
    throw { status: 404, message: "Work report not found" };
  }

  if (current.actualEndAt) {
    return current;
  }

  const timing = computeStoppedWorkReportMinutes({
    actualStartAt: current.actualStartAt || now,
    actualEndAt: now,
    pausedMinutes: nonNegativeInt(current.pausedMinutes),
    pauseStartAt: current.pauseStartAt
  });
  const previous = current.workPerformed ?? "";
  const appended = notes
    ? `${previous}\n${String(notes)}`.trim()
    : previous;

  const stopData = current.actualStartAt
    ? {
        actualEndAt: now,
        actualMinutes: timing.actualMinutes,
        pausedMinutes: timing.pausedMinutes,
        pauseStartAt: null,
        workPerformed: appended
      }
    : {
        actualStartAt: now,
        actualEndAt: now,
        actualMinutes: 0,
        pausedMinutes: 0,
        pauseStartAt: null,
        workPerformed: appended
      };

  const updatedCount = await tx.workReport.updateMany({
    where: {
      interventionId,
      version: current.version,
      actualEndAt: null
    },
    data: {
      ...stopData,
      version: { increment: 1 }
    }
  });
  if (updatedCount.count !== 1) {
    const latest = await tx.workReport.findUnique({ where: { interventionId } });
    if (!latest) {
      throw { status: 404, message: "Work report not found" };
    }
    if (latest.actualEndAt) {
      return latest;
    }
    throw { status: 409, message: TIMING_CONFLICT_MESSAGE };
  }
  const updated = await tx.workReport.findUnique({ where: { interventionId } });
  if (!updated) {
    throw { status: 404, message: "Work report not found" };
  }

  await tx.intervention.update({
    where: { id: interventionId },
    data: {
      version: { increment: 1 },
      ...(TERMINAL_INTERVENTION_STATUSES.has(intervention.status)
        ? {}
        : { status: InterventionStatus.COMPLETED })
    }
  });

  return updated;
}
