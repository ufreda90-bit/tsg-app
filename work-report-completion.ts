export const INTERVENTION_COMPLETION_BLOCKED_ERROR_MESSAGE =
  'Completamento non consentito: compila "Lavori svolti" e aggiungi almeno un allegato alla bolla.'

type CompletionWorkReportRow = {
  id: string;
  workPerformed: string | null;
}

export type WorkReportCompletionTx = {
  workReport: {
    findUnique(args: {
      where: { interventionId: number };
      select: { id: true; workPerformed: true };
    }): Promise<CompletionWorkReportRow | null>;
  };
  workReportAttachment: {
    count(args: { where: { workReportId: string } }): Promise<number>;
  };
}

export function hasMeaningfulWorkPerformed(workPerformed: string | null | undefined) {
  return typeof workPerformed === "string" && workPerformed.trim().length > 0
}

export async function getInterventionCompletionEligibility(params: {
  tx: WorkReportCompletionTx;
  interventionId: number;
  workReportId?: string | null;
  workPerformed?: string | null;
}) {
  const { tx, interventionId } = params;

  let workReportId = params.workReportId ?? null;
  let workPerformed = params.workPerformed;

  if (!workReportId || workPerformed === undefined) {
    const report = await tx.workReport.findUnique({
      where: { interventionId },
      select: { id: true, workPerformed: true }
    });

    if (!report) {
      return {
        eligible: false,
        hasWorkPerformed: false,
        workReportAttachmentCount: 0
      };
    }

    workReportId = workReportId ?? report.id;
    if (workPerformed === undefined) {
      workPerformed = report.workPerformed;
    }
  }

  const hasWorkPerformed = hasMeaningfulWorkPerformed(workPerformed);
  const workReportAttachmentCount = workReportId
    ? await tx.workReportAttachment.count({ where: { workReportId } })
    : 0;

  return {
    eligible: hasWorkPerformed && workReportAttachmentCount > 0,
    hasWorkPerformed,
    workReportAttachmentCount
  };
}
