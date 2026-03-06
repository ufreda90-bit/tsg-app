const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * USO:
 *   TECH=21 node reset-by-tech.cjs
 */
const tech = Number(process.env.TECH);
if (!Number.isFinite(tech) || tech <= 0) {
  console.error('❌ Devi passare TECH, esempio: TECH=21 node reset-by-tech.cjs');
  process.exit(1);
}

(async () => {
  const list = await prisma.intervention.findMany({
    where: { OR: [{ technicianId: tech }, { secondaryTechnicianId: tech }] },
    select: { id: true }
  });

  const ids = list.map(x => x.id);
  if (!ids.length) {
    console.log('⚠️ Nessun intervento trovato per TECH=', tech);
    return;
  }

  await prisma.intervention.updateMany({
    where: { id: { in: ids } },
    data: { status: 'SCHEDULED', version: 0 }
  });

  await prisma.workReport.updateMany({
    where: { interventionId: { in: ids } },
    data: {
      actualStartAt: null,
      actualEndAt: null,
      clientStartAt: null,
      clientEndAt: null,
      actualMinutes: 0,
      pausedMinutes: 0,
      pauseStartAt: null,
      workPerformed: '',
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

  console.log(`✅ Reset tecnico ${tech}: ${ids.length} interventi`);
  console.log(ids.join(','));
})()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
