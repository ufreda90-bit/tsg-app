import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const id = 221;

const i = await prisma.intervention.findUnique({
  where: { id },
  include: { workReport: true },
});

console.log("status:", i?.status);
console.log("actualMinutes:", i?.workReport?.actualMinutes);
console.log("clientEndAt:", i?.workReport?.clientEndAt);

await prisma.$disconnect();