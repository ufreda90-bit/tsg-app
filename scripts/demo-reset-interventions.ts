import "dotenv/config";
import { PrismaClient, InterventionStatus } from "@prisma/client";

const prisma = new PrismaClient();

const TERMINAL_STATUSES: InterventionStatus[] = [
  InterventionStatus.COMPLETED,
  InterventionStatus.FAILED,
  InterventionStatus.CANCELLED,
  InterventionStatus.NO_SHOW
];

type Args = {
  tech?: number;
  from?: Date;
  toExclusive?: Date;
  statuses?: InterventionStatus[];
  dryRun: boolean;
};

function parseBool(value: string | undefined) {
  if (!value) return false;
  return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
}

function parseTech() {
  const raw = process.env.TECH;
  if (!raw) return undefined;
  const tech = Number(raw);
  if (!Number.isFinite(tech) || tech <= 0) {
    throw new Error(`TECH non valido: ${raw}`);
  }
  return tech;
}

function parseDateBoundary(raw: string | undefined, kind: "from" | "to") {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const dateOnlyMatch = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  if (dateOnlyMatch) {
    const [y, m, d] = trimmed.split("-").map(Number);
    if (kind === "from") {
      return new Date(y, m - 1, d, 0, 0, 0, 0);
    }
    return new Date(y, m - 1, d + 1, 0, 0, 0, 0); // exclusive next day
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${kind.toUpperCase()} non valido: ${raw}`);
  }
  if (kind === "to") {
    return new Date(parsed.getTime() + 1);
  }
  return parsed;
}

function parseStatuses() {
  const raw = process.env.STATUSES?.trim();
  if (!raw) {
    return TERMINAL_STATUSES;
  }

  const tokens = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (!tokens.length) {
    return TERMINAL_STATUSES;
  }

  const values = new Set<InterventionStatus>();
  const validStatuses = new Set(Object.values(InterventionStatus));

  for (const token of tokens) {
    if (token === "CLOSED" || token === "DONE" || token === "TERMINAL") {
      for (const status of TERMINAL_STATUSES) {
        values.add(status);
      }
      continue;
    }

    if (!validStatuses.has(token as InterventionStatus)) {
      throw new Error(
        `STATUSES contiene valore non valido: ${token}. Valori ammessi: ${Object.values(InterventionStatus).join(", ")} o alias CLOSED/DONE`
      );
    }
    values.add(token as InterventionStatus);
  }

  return [...values];
}

function buildArgs(): Args {
  const from = parseDateBoundary(process.env.FROM, "from");
  const toExclusive = parseDateBoundary(process.env.TO, "to");
  if (from && toExclusive && toExclusive <= from) {
    throw new Error("Intervallo date non valido: TO deve essere successivo a FROM");
  }

  return {
    tech: parseTech(),
    from,
    toExclusive,
    statuses: parseStatuses(),
    dryRun: parseBool(process.env.DRY_RUN)
  };
}

function buildWhere(args: Args) {
  const where: any = {};

  if (args.statuses && args.statuses.length) {
    where.status = { in: args.statuses };
  }

  if (args.tech) {
    where.OR = [{ technicianId: args.tech }, { secondaryTechnicianId: args.tech }];
  }

  if (args.from || args.toExclusive) {
    where.startAt = {};
    if (args.from) where.startAt.gte = args.from;
    if (args.toExclusive) where.startAt.lt = args.toExclusive;
  }

  return where;
}

function formatDateForLog(date: Date | undefined) {
  if (!date) return "-";
  return date.toISOString();
}

async function main() {
  const args = buildArgs();
  const where = buildWhere(args);

  const matches = await prisma.intervention.findMany({
    where,
    select: {
      id: true,
      status: true,
      technicianId: true,
      secondaryTechnicianId: true,
      startAt: true,
      workReport: {
        select: {
          id: true
        }
      }
    },
    orderBy: { id: "asc" }
  });

  const ids = matches.map((row) => row.id);
  const statusCounts = matches.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  console.log("=== DEMO RESET PREVIEW ===");
  console.log(`Filtro status: ${(args.statuses || []).join(", ") || "(none)"}`);
  console.log(`Filtro tech: ${args.tech ?? "-"}`);
  console.log(`Filtro from: ${formatDateForLog(args.from)}`);
  console.log(`Filtro to(exclusive): ${formatDateForLog(args.toExclusive)}`);
  console.log(`Dry run: ${args.dryRun ? "true" : "false"}`);
  console.log(`Interventi match: ${matches.length}`);
  console.log(`Con workReport: ${matches.filter((m) => !!m.workReport).length}`);
  console.log(`Distribuzione stati: ${JSON.stringify(statusCounts)}`);

  if (!matches.length) {
    console.log("Nessun intervento da resettare.");
    return;
  }

  console.log(
    `Sample IDs: ${ids.slice(0, 20).join(", ")}${ids.length > 20 ? ` ... (+${ids.length - 20})` : ""}`
  );

  if (args.dryRun) {
    console.log("Dry run completato. Nessuna modifica applicata.");
    return;
  }

  const [interventionResult, workReportResult] = await prisma.$transaction([
    prisma.intervention.updateMany({
      where: { id: { in: ids } },
      data: {
        status: InterventionStatus.SCHEDULED,
        version: 0
      }
    }),
    prisma.workReport.updateMany({
      where: { interventionId: { in: ids } },
      data: {
        version: 0,
        actualStartAt: null,
        actualEndAt: null,
        clientStartAt: null,
        clientEndAt: null,
        actualMinutes: 0,
        pausedMinutes: 0,
        pauseStartAt: null,
        workPerformed: "",
        extraWork: null,
        materials: null,
        customerName: null,
        customerEmail: null,
        signatureToken: null,
        signatureRequestedAt: null,
        customerSignatureDataUrl: null,
        signedAt: null,
        emailedAt: null
      }
    })
  ]);

  const scheduledAfter = await prisma.intervention.count({
    where: { id: { in: ids }, status: InterventionStatus.SCHEDULED }
  });

  const cleanReportsAfter = await prisma.workReport.count({
    where: {
      interventionId: { in: ids },
      version: 0,
      actualStartAt: null,
      actualEndAt: null,
      clientStartAt: null,
      clientEndAt: null,
      actualMinutes: 0,
      pausedMinutes: 0,
      pauseStartAt: null,
      workPerformed: "",
      extraWork: null,
      materials: null,
      customerName: null,
      customerEmail: null,
      signatureToken: null,
      signatureRequestedAt: null,
      customerSignatureDataUrl: null,
      signedAt: null,
      emailedAt: null
    }
  });

  console.log("=== DEMO RESET RESULT ===");
  console.log(`Interventi aggiornati: ${interventionResult.count}`);
  console.log(`WorkReport aggiornate: ${workReportResult.count}`);
  console.log(`Interventi ora in SCHEDULED (sui match): ${scheduledAfter}/${ids.length}`);
  console.log(`WorkReport azzerate verificate: ${cleanReportsAfter}/${workReportResult.count}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
