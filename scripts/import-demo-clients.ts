import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CUSTOMER_TYPES = new Set(["PRIVATO", "AZIENDA"] as const);
const PREFERRED_TIME_SLOTS = new Set([
  "MATTINA",
  "PRANZO",
  "POMERIGGIO",
  "SERA",
  "INDIFFERENTE"
] as const);

type CustomerType = "PRIVATO" | "AZIENDA";
type PreferredTimeSlot = "MATTINA" | "PRANZO" | "POMERIGGIO" | "SERA" | "INDIFFERENTE";

type CsvRow = Record<string, string>;

function parseCsvLine(line: string) {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }

  fields.push(current);
  return fields;
}

function parseCsv(content: string) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/^\uFEFF/, "");
  const lines = normalized.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    throw new Error("CSV vuoto");
  }

  const header = parseCsvLine(lines[0]).map((value) => value.trim());
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length !== header.length) {
      throw new Error(`Riga ${i + 1}: numero colonne non valido (attese ${header.length}, trovate ${fields.length})`);
    }
    const row: CsvRow = {};
    for (let j = 0; j < header.length; j += 1) {
      row[header[j]] = fields[j] ?? "";
    }
    rows.push(row);
  }

  return { header, rows };
}

function normalizeNullable(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function normalizePhone(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, "");
}

function parseCustomerType(value: string | undefined): CustomerType {
  const normalized = (value ?? "").trim().toUpperCase();
  if (CUSTOMER_TYPES.has(normalized as CustomerType)) {
    return normalized as CustomerType;
  }
  throw new Error(`customerType non valido: "${value ?? ""}"`);
}

function parsePreferredTimeSlot(value: string | undefined): PreferredTimeSlot {
  const normalized = (value ?? "").trim().toUpperCase();
  if (PREFERRED_TIME_SLOTS.has(normalized as PreferredTimeSlot)) {
    return normalized as PreferredTimeSlot;
  }
  throw new Error(`preferredTimeSlot non valido: "${value ?? ""}"`);
}

async function main() {
  const inputArg = process.argv[2] || "seed/demo-clients.csv";
  const csvPath = path.resolve(process.cwd(), inputArg);

  const content = await fs.readFile(csvPath, "utf8");
  const { header, rows } = parseCsv(content);

  const requiredColumns = [
    "name",
    "companyName",
    "email",
    "phone",
    "taxCode",
    "addressLine",
    "city",
    "customerType",
    "preferredTimeSlot",
    "notes"
  ];

  for (const column of requiredColumns) {
    if (!header.includes(column)) {
      throw new Error(`Colonna mancante nel CSV: ${column}`);
    }
  }

  const defaultOrganization =
    (await prisma.organization.findFirst({ orderBy: { id: "asc" } })) ||
    (await prisma.organization.create({
      data: {
        name: "Demo Organization",
        plan: "DEMO"
      }
    }));
  const organizationId = defaultOrganization.id;

  let created = 0;
  let updated = 0;
  let failed = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const lineNo = index + 2;

    try {
      const name = (row.name ?? "").trim();
      if (!name) {
        throw new Error("name obbligatorio");
      }

      const taxCode = normalizeNullable(row.taxCode)?.toUpperCase();
      if (!taxCode) {
        throw new Error("taxCode obbligatorio (chiave idempotente import)");
      }

      const email = normalizeNullable(row.email)?.toLowerCase() ?? null;
      const phone = normalizePhone(row.phone);
      const companyName = normalizeNullable(row.companyName);
      const addressLine = normalizeNullable(row.addressLine);
      const city = normalizeNullable(row.city);
      const notes = normalizeNullable(row.notes);
      const customerType = parseCustomerType(row.customerType);
      const preferredTimeSlot = parsePreferredTimeSlot(row.preferredTimeSlot);

      const payload = {
        organizationId,
        name,
        companyName,
        email,
        phone1: phone,
        taxCode,
        addressLine,
        city,
        notes,
        customerType,
        preferredTimeSlot,
        isActive: true
      };

      const existing = await prisma.customer.findUnique({
        where: { organizationId_taxCode: { organizationId, taxCode } },
        select: { id: true }
      });

      await prisma.customer.upsert({
        where: { organizationId_taxCode: { organizationId, taxCode } },
        update: payload,
        create: payload
      });

      if (existing) {
        updated += 1;
      } else {
        created += 1;
      }
    } catch (error: any) {
      failed += 1;
      console.error(`[row ${lineNo}] ${error?.message || error}`);
    }
  }

  console.log(`Import completato: created=${created} updated=${updated} failed=${failed}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
