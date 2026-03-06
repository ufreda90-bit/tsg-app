export function nonNegativeInt(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function safeFloorMinutesBetween(start: Date, end: Date) {
  const deltaMs = end.getTime() - start.getTime();
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
  return Math.floor(deltaMs / 60_000);
}

export function clampPausedMinutesToTotal(pausedMinutes: number, totalMinutes: number) {
  const safePaused = nonNegativeInt(pausedMinutes);
  const safeTotal = nonNegativeInt(totalMinutes);
  return Math.min(safePaused, safeTotal);
}

export function computeStopTimingFromMilliseconds(params: {
  actualStartAt: Date;
  actualEndAt: Date;
  pausedMinutesIntSoFar: number;
  openPauseStartAt: Date | null;
}) {
  const startMs = params.actualStartAt.getTime();
  const endMs = params.actualEndAt.getTime();
  const elapsedMs = Math.max(0, endMs - startMs);
  const totalElapsedFloorMinutes = Math.floor(elapsedMs / 60_000);

  const openPauseMinutesInt = params.openPauseStartAt
    ? safeFloorMinutesBetween(params.openPauseStartAt, params.actualEndAt)
    : 0;

  const pausedMinutesIntRaw = nonNegativeInt(params.pausedMinutesIntSoFar) + openPauseMinutesInt;
  const pausedMinutesIntTotal = clampPausedMinutesToTotal(pausedMinutesIntRaw, totalElapsedFloorMinutes);
  const pausedMsTotal = pausedMinutesIntTotal * 60_000;

  const workedMs = Math.max(0, elapsedMs - pausedMsTotal);
  const actualMinutesInt = Math.floor(workedMs / 60_000);

  return {
    openPauseMinutesInt,
    pausedMinutesIntTotal,
    pausedMsTotal,
    workedMs,
    actualMinutesInt,
    elapsedMs,
    totalElapsedFloorMinutes
  };
}
