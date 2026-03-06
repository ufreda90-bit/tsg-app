const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const id = 221; // <<< CAMBIA QUI ID

async function run() {
  await prisma.intervention.update({
    where: { id },
    data: {
      status: 'SCHEDULED',
      version: 0
    }
  });

  await prisma.workReport.updateMany({
    where: { interventionId: id },
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

  console.log("✅ Reset completato per intervento", id);
}

run()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });