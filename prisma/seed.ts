import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

if (
  process.env.NODE_ENV === "production" &&
  process.env.ALLOW_SEED_IN_PROD !== "I_UNDERSTAND_THIS_WIPES_DATA"
) {
  throw new Error("Refusing to run prisma seed in production. Set ALLOW_SEED_IN_PROD=I_UNDERSTAND_THIS_WIPES_DATA to proceed intentionally.");
}

const prisma = new PrismaClient();

async function main() {
  // Clean up existing data (atomic, no orphans)
  await prisma.$transaction([
    prisma.refreshToken.deleteMany(),
    prisma.user.deleteMany(),
    prisma.pushSubscription.deleteMany(),
    prisma.media.deleteMany(),
    prisma.workReport.deleteMany(),
    prisma.intervention.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.technician.deleteMany()
  ]);

  // Create Technicians
  const techniciansSeed = [
    { name: 'Mariano', color: '#ef4444', skills: 'generale', phone: '3331000001' },
    { name: 'Francesco', color: '#22c55e', skills: 'generale', phone: '3331000002' },
    { name: 'Alessandro', color: '#eab308', skills: 'generale', phone: '3331000003' },
    { name: 'Giuliano', color: '#3b82f6', skills: 'generale', phone: '3331000004' },
    { name: 'Beni', color: '#8b5cf6', skills: 'generale', phone: '3331000005' },
    { name: 'Cosimo', color: '#ec4899', skills: 'generale', phone: '3331000006' },
    { name: 'Antonio', color: '#06b6d4', skills: 'generale', phone: '3331000007' },
    { name: 'Giuseppe', color: '#84cc16', skills: 'generale', phone: '3331000008' },
    { name: 'Jo', color: '#f97316', skills: 'generale', phone: '3331000009' },
    { name: 'Momo', color: '#14b8a6', skills: 'generale', phone: '3331000010' }
  ];

  const createdTechs = [];
  for (const t of techniciansSeed) {
    createdTechs.push(await prisma.technician.create({ data: t }));
  }

  console.log('Created technicians:', createdTechs.map(t => t.name));

  const adminHash = await bcrypt.hash('Admin123!', 10);
  const dispatcherHash = await bcrypt.hash('Dispatcher123!', 10);
  const techHash = await bcrypt.hash('Tech123!', 10);

  await prisma.user.create({
    data: {
      name: 'Admin',
      email: 'admin@demo.local',
      passwordHash: adminHash,
      role: 'ADMIN'
    }
  });

  await prisma.user.create({
    data: {
      name: 'Dispatcher',
      email: 'dispatcher@demo.local',
      passwordHash: dispatcherHash,
      role: 'DISPATCHER'
    }
  });

  if (createdTechs[0]) {
    await prisma.user.create({
      data: {
        name: 'Tecnico 1',
        email: 'tech1@demo.local',
        passwordHash: techHash,
        role: 'TECHNICIAN',
        technicianId: createdTechs[0].id
      }
    });
  }

  // Create Interventions (80 appointments in 10 days, starting tomorrow)
  const baseDate = new Date();
  baseDate.setHours(0, 0, 0, 0);
  baseDate.setDate(baseDate.getDate() + 1);

  const techByName = new Map(createdTechs.map(t => [t.name, t]));
  const teams = [
    { name: 'Squadra 1', primary: techByName.get('Mariano')!, secondary: null },
    { name: 'Squadra 2', primary: techByName.get('Francesco')!, secondary: techByName.get('Alessandro') || null },
    { name: 'Squadra 3', primary: techByName.get('Giuliano')!, secondary: techByName.get('Beni') || null },
    { name: 'Squadra 4', primary: techByName.get('Cosimo')!, secondary: techByName.get('Antonio') || null },
    { name: 'Squadra 5', primary: techByName.get('Giuseppe')!, secondary: null },
    { name: 'Squadra 6', primary: techByName.get('Jo')!, secondary: techByName.get('Momo') || null }
  ].filter(t => t.primary);

  const titles = [
    'Sopralluogo impianto',
    'Manutenzione ordinaria',
    'Intervento urgente',
    'Sostituzione componente',
    'Ripristino guasto',
    'Controllo sicurezza',
    'Verifica finale',
    'Installazione accessori'
  ];

  const addresses = [
    'Via Roma 10, Milano',
    'Corso Italia 5, Milano',
    'Via Dante 3, Milano',
    'Viale Monza 20, Milano',
    'Piazza Duomo 1, Milano',
    'Via Manzoni 12, Milano',
    'Via Torino 45, Milano',
    'Viale Europa 7, Milano'
  ];

  const descriptions = [
    'Intervento programmato',
    'Richiesta cliente',
    'Controllo periodico',
    'Guasto segnalato',
    'Attivita di verifica'
  ];

  const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

  const interventionsData = [];
  let appointmentIndex = 0;

  const days = 10;
  const baseTotal = days * teams.length;
  const targetTotal = 80;
  const extraTotal = Math.max(0, targetTotal - baseTotal);

  let seed = 246813579;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const randInt = (max: number) => Math.floor(nextRand() * max);

  const extraPerDay = Array(days).fill(0);
  let remaining = extraTotal;
  while (remaining > 0) {
    const dayIdx = randInt(days);
    if (extraPerDay[dayIdx] < 4) {
      extraPerDay[dayIdx] += 1;
      remaining -= 1;
    }
  }

  const patternsTwo = [
    [[8, 12], [13, 18]],
    [[8, 12], [12, 18]],
    [[8, 11], [12, 18]],
    [[8, 13], [13, 18]]
  ];

  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const day = new Date(baseDate);
    day.setDate(baseDate.getDate() + dayOffset);

    const teamIndices = teams.map((_, idx) => idx);
    for (let i = teamIndices.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [teamIndices[i], teamIndices[j]] = [teamIndices[j], teamIndices[i]];
    }
    const extraTeams = new Set(teamIndices.slice(0, extraPerDay[dayOffset]));

    const makeIntervention = (team: typeof teams[number], startHour: number, endHour: number) => {
      const startAt = new Date(day);
      startAt.setHours(startHour, 0, 0, 0);
      const endAt = new Date(day);
      endAt.setHours(endHour, 0, 0, 0);

      interventionsData.push({
        title: `${titles[appointmentIndex % titles.length]} #${appointmentIndex + 1}`,
        address: addresses[appointmentIndex % addresses.length],
        description: descriptions[appointmentIndex % descriptions.length],
        status: 'SCHEDULED',
        priority: priorities[appointmentIndex % priorities.length],
        technicianId: team.primary.id,
        secondaryTechnicianId: team.secondary ? team.secondary.id : null,
        startAt,
        endAt
      });

      appointmentIndex++;
    };

    teams.forEach((team, idx) => {
      const count = extraTeams.has(idx) ? 2 : 1;
      if (count === 1) {
        makeIntervention(team, 8, 18);
        return;
      }

      const pattern = patternsTwo[randInt(patternsTwo.length)];
      pattern.forEach(([startHour, endHour]) => makeIntervention(team, startHour, endHour));
    });
  }

  const toBillCount = Math.floor(targetTotal * 0.25);
  const doneCount = Math.floor(targetTotal * 0.25);
  const todoStatuses = ['SCHEDULED', 'IN_PROGRESS', 'FAILED', 'NO_SHOW', 'CANCELLED'];

  const statusPlan: Array<{ status: string; billed: boolean }> = [];
  for (let i = 0; i < toBillCount; i++) statusPlan.push({ status: 'COMPLETED', billed: false });
  for (let i = 0; i < doneCount; i++) statusPlan.push({ status: 'COMPLETED', billed: true });
  for (let i = statusPlan.length; i < targetTotal; i++) {
    statusPlan.push({ status: todoStatuses[i % todoStatuses.length], billed: false });
  }

  for (let i = statusPlan.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [statusPlan[i], statusPlan[j]] = [statusPlan[j], statusPlan[i]];
  }

  let reportNumber = 1;
  const interventionsToCreate = interventionsData.map((data, idx) => {
    const { status, billed } = statusPlan[idx] || { status: 'SCHEDULED', billed: false };
    const workReport =
      status === 'COMPLETED'
        ? {
            create: {
              reportNumber: reportNumber++,
              workPerformed: 'Intervento completato',
              ...(billed ? { emailedAt: new Date() } : {})
            }
          }
        : undefined;

    return prisma.intervention.create({
      data: {
        ...data,
        status,
        workReport
      }
    });
  });

  await prisma.$transaction(interventionsToCreate);

  console.log('Seeded interventions:', interventionsData.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
