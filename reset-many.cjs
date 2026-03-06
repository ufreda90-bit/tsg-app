const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * USO:
 *   IDS="221,222,223" node reset-many.cjs
 */
const ids = (process.env.IDS || '')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => Number.isFinite(n) && n > 0);

if (!ids.length) {
  console.error('❌ Devi passare IDS, esempio: IDS="221,222" node reset-many.cjs');
  process.exit(1);
}

(async () => {
  // 1) reset interventi
  await prisma.intervention.updateMany({
    where: { id: { in: ids } },
    data: { status: 'SCHEDULED', version: 0 }
  });

  // 2) reset workReport collegati
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

  // 3) verifica veloce
  const rows = await prisma.intervention.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, version: true, workReport: { select: { actualMinutes: true, signedAt: true, emailedAt: true } } }
  });

  console.log('✅ Reset completati:');
  for (const r of rows) {
    console.log(`- #${r.id} status=${r.status} version=${r.version} minutes=${r.workReport?.actualMinutes ?? 'n/a'}`);
  }
})()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
