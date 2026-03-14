import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import { PrismaClient, Role, InterventionStatus, Prisma, AttachmentKind } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import nodemailer from "nodemailer";
import webpush from "web-push";
import { jsPDF } from "jspdf";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import jwt, { JwtPayload } from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "crypto";
import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import {
  computeStoppedWorkReportMinutes,
  stopWorkReportInTransaction
} from "./work-report-stop.ts";
import {
  pauseStartWorkReportInTransaction,
  pauseStopWorkReportInTransaction
} from "./work-report-pause.ts";
import { updateWorkReportContentWithOptimisticLock } from "./work-report-update.ts";
import {
  getPublicSignWorkReportByTokenOrThrow,
  signWorkReportByTokenInTransaction
} from "./work-report-sign.ts";
import {
  getInterventionCompletionEligibility,
  INTERVENTION_COMPLETION_BLOCKED_ERROR_MESSAGE
} from "./work-report-completion.ts";

type AuthUser = {
  id: number;
  role: Role;
  technicianId: number | null;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

const prisma = new PrismaClient();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function logApiError(req: express.Request, error: unknown) {
  const requestId = req.requestId || "-";
  const route = `${req.method} ${req.originalUrl || req.url}`;
  console.error(`[API Error] reqId=${requestId} route=${route}`, error);
}

function sendError(
  res: express.Response,
  status: number,
  message: string,
  code?: string,
  extra?: Record<string, unknown>
) {
  return res.status(status).json({
    ok: false,
    error: message,
    ...(code ? { code } : {}),
    ...(extra ? extra : {})
  });
}

function normalizeAddress(input: string): string {
  const raw = typeof input === "string" ? input : "";
  if (!raw.trim()) return "";
  return raw
    .toLowerCase()
    .replace(/[.,;:!?'"`’“”()[\]{}<>\\/|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAddressSearchTokens(addressKey: string, maxTokens = 3): string[] {
  if (!addressKey) return [];
  const dedup = new Set<string>();
  for (const token of addressKey.split(" ")) {
    const cleaned = token.trim();
    if (cleaned.length < 3) continue;
    dedup.add(cleaned);
    if (dedup.size >= maxTokens) break;
  }
  return [...dedup];
}

function truncateText(input: string | null | undefined, maxLength = 300): string {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "";
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, maxLength)}...`;
}

function normalizeLoginEmail(input: string | null | undefined): string | null {
  if (input === undefined || input === null) return null;
  const value = input.trim().toLowerCase();
  return value || null;
}

function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

type AuditOutcome = "success" | "noop" | "conflict" | "forbidden" | "not_found" | "error";
type AuditEntity = Record<string, string | number | null | undefined>;
type AuditMeta = Record<string, string | number | boolean | null | undefined>;

function auditOutcomeFromStatus(status: number): AuditOutcome {
  if (status === 401 || status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return "error";
}

function auditLog(
  req: express.Request,
  action: string,
  entity: AuditEntity,
  outcome: AuditOutcome,
  meta?: AuditMeta
) {
  try {
    const payload: Record<string, unknown> = {
      type: "AUDIT",
      ts: new Date().toISOString(),
      requestId: req.requestId || null,
      user: req.user ? { id: req.user.id, role: req.user.role } : null,
      ip: req.ip || null,
      action,
      entity,
      outcome
    };
    if (meta && Object.keys(meta).length > 0) {
      payload.meta = meta;
    }
    const line = JSON.stringify(payload);
    if (outcome === "success" || outcome === "noop") {
      console.info(line);
      return;
    }
    if (outcome === "conflict" || outcome === "forbidden" || outcome === "not_found") {
      console.warn(line);
      return;
    }
    console.error(line);
  } catch {
    // never throw from audit logging
  }
}

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "uploads");
const ATTACHMENT_MAX_FILE_SIZE_BYTES = Math.max(
  1,
  Number(process.env.ATTACHMENT_MAX_FILE_SIZE_MB || 15)
) * 1024 * 1024;
const ATTACHMENT_MAX_FILES = Math.max(1, Number(process.env.ATTACHMENT_MAX_FILES || 10));
const ATTACHMENTS_HEALTH_SCAN_LIMIT = Math.max(1, Number(process.env.ATTACHMENTS_HEALTH_SCAN_LIMIT || 2000));
const ATTACHMENTS_CLEANUP_SCAN_LIMIT = Math.max(1, Number(process.env.ATTACHMENTS_CLEANUP_SCAN_LIMIT || 5000));
const ATTACHMENTS_CLEANUP_MIN_AGE_DAYS = Math.max(0, Number(process.env.ATTACHMENTS_CLEANUP_MIN_AGE_DAYS || 7));
const ATTACHMENTS_SAMPLE_LIMIT = 20;
const ATTACHMENT_UPLOAD_RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.ATTACHMENT_UPLOAD_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000));
const ATTACHMENT_UPLOAD_RATE_LIMIT_MAX = Math.max(1, Number(process.env.ATTACHMENT_UPLOAD_RATE_LIMIT_MAX || 30));
const STORED_ATTACHMENT_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]{1,10}$/i;
const TEAM_STORE_FILE = path.resolve(process.cwd(), "data", "teams.json");
const TEAM_STORE_DIR = path.dirname(TEAM_STORE_FILE);
const TEAM_HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;
const ATTACHMENT_ALLOWED_MIME_TO_EXTENSIONS: Record<string, string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "audio/mpeg": [".mp3"],
  "audio/wav": [".wav"],
  "audio/webm": [".webm"],
  "audio/ogg": [".ogg"],
  "audio/mp4": [".m4a", ".mp4"],
  "video/mp4": [".mp4"],
  "video/quicktime": [".mov", ".qt"],
  "application/pdf": [".pdf"]
};
// TODO(hardening): optional future step, persist sha256 for uploaded attachments if/when schema is extended.
const INLINE_DOWNLOAD_MIME_PREFIXES = ["image/", "audio/", "video/"];

function isAllowedAttachmentMimeAndExtension(mimeType: string, originalName: string) {
  const allowedExtensions = ATTACHMENT_ALLOWED_MIME_TO_EXTENSIONS[mimeType.toLowerCase()];
  if (!allowedExtensions) return false;
  const ext = safeAttachmentExtension(originalName).toLowerCase();
  return allowedExtensions.includes(ext);
}

function attachmentKindFromMime(mimeType: string): AttachmentKind {
  if (mimeType.startsWith("image/")) return AttachmentKind.IMAGE;
  if (mimeType.startsWith("audio/")) return AttachmentKind.AUDIO;
  return AttachmentKind.FILE;
}

function safeAttachmentExtension(originalName: string) {
  const ext = path.extname(path.basename(originalName || "")).toLowerCase();
  if (!ext || ext.length > 10 || !/^\.[a-z0-9]+$/i.test(ext)) return ".bin";
  return ext;
}

function buildStoredAttachmentName(originalName: string) {
  return `${randomUUID()}${safeAttachmentExtension(originalName)}`;
}

function sanitizeOriginalFilename(input: string) {
  const raw = path.basename(input || "file");
  const noControlChars = raw.replace(/[\x00-\x1F\x7F]/g, "");
  const noSlashes = noControlChars.replace(/[\\/]/g, "");
  const compact = noSlashes.replace(/\s+/g, " ").trim();
  const trimmed = compact.slice(0, 180);
  return trimmed || "file";
}

function encodeContentDispositionFilename(value: string) {
  return encodeURIComponent(value)
    .replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildContentDispositionHeader(mimeType: string, originalName: string) {
  const safeOriginalName = sanitizeOriginalFilename(originalName);
  const asciiFallback = safeOriginalName
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");
  const dispositionType = mimeType === "application/pdf" || INLINE_DOWNLOAD_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
    ? "inline"
    : "attachment";
  return `${dispositionType}; filename="${asciiFallback}"; filename*=UTF-8''${encodeContentDispositionFilename(safeOriginalName)}`;
}

function buildUploadValidationError(message: string, status: number, code: string) {
  const err = new Error(message) as Error & { status?: number; code?: string };
  err.status = status;
  err.code = code;
  return err;
}

function toAttachmentDto<T extends { id: string; kind: string; mimeType: string; originalName: string; size: number; createdAt: Date }>(a: T) {
  return {
    id: a.id,
    kind: a.kind,
    mimeType: a.mimeType,
    originalName: a.originalName,
    size: a.size,
    createdAt: a.createdAt,
    downloadUrl: `/api/attachments/${a.id}/download`
  };
}

function userCanAccessIntervention(user: AuthUser | undefined, intervention: { technicianId: number | null; secondaryTechnicianId: number | null }) {
  if (!user) return false;
  if (user.role === Role.ADMIN || user.role === Role.DISPATCHER) return true;
  if (user.role !== Role.TECHNICIAN || !user.technicianId) return false;
  return intervention.technicianId === user.technicianId || intervention.secondaryTechnicianId === user.technicianId;
}

async function safeUnlinkFile(filePath: string) {
  try {
    await fsPromises.unlink(filePath);
  } catch {
    // ignore cleanup failures
  }
}

function buildAttachmentFilePath(storedName: string) {
  return path.join(UPLOAD_DIR, path.basename(storedName || ""));
}

function isStoredAttachmentNameSafe(storedName: string) {
  return STORED_ATTACHMENT_NAME_PATTERN.test(path.basename(storedName || ""));
}

async function fileExistsReadable(filePath: string) {
  try {
    await fsPromises.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function listUploadFilesBounded(limit: number) {
  const names: string[] = [];
  let isPartial = false;
  try {
    const dir = await fsPromises.opendir(UPLOAD_DIR);
    for await (const dirent of dir) {
      if (!dirent.isFile()) continue;
      names.push(dirent.name);
      if (names.length >= limit) {
        isPartial = true;
        break;
      }
    }
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return { names, isPartial: false };
    }
    throw error;
  }
  return { names, isPartial };
}

type ResolvedAttachmentDownload = {
  id: string;
  source: "intervention" | "workReport";
  interventionId: number;
  storedName: string;
  mimeType: string;
  originalName: string;
  access: { technicianId: number | null; secondaryTechnicianId: number | null };
};

const storedTeamSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  color: z.string().trim().regex(TEAM_HEX_COLOR_PATTERN),
  memberIds: z.array(z.number().int().positive()),
  isActive: z.boolean().default(true),
  capacityPerDay: z.number().int().min(1).max(1000).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict();

type StoredTeam = z.infer<typeof storedTeamSchema>;

const storedTeamsSchema = z.array(storedTeamSchema);

const teamCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  color: z.string().trim().regex(TEAM_HEX_COLOR_PATTERN).optional(),
  memberIds: z.array(z.number().int().positive()).default([]),
  isActive: z.boolean().optional(),
  capacityPerDay: z.number().int().min(1).max(1000).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional()
}).strict();

const teamPatchSchema = teamCreateSchema.partial().strict();

const technicianCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  skills: z.string().trim().max(500).optional().nullable(),
  color: z.string().trim().regex(TEAM_HEX_COLOR_PATTERN).optional(),
  isActive: z.boolean().optional()
}).strict();

const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;

const userCreateSchema = z.object({
  username: z.string().trim().min(3).max(64),
  email: z.string().trim().email().max(320).optional().or(z.literal("")).nullable(),
  password: z.string().min(8).max(128),
  role: z.nativeEnum(Role),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(1).max(120).optional()
}).strict();

const userPatchSchema = z.object({
  username: z.string().trim().min(3).max(64).optional(),
  email: z.string().trim().email().max(320).optional().or(z.literal("")).nullable(),
  password: z.string().max(128).optional(),
  role: z.nativeEnum(Role).optional(),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(1).max(120).optional()
}).strict();

type TeamMemberDto = {
  id: number;
  name: string;
  color: string;
  isActive: boolean;
};

function normalizeTeamColor(color: string) {
  const trimmed = color.trim();
  if (!trimmed) return "#3b82f6";
  return trimmed.startsWith("#") ? trimmed.toLowerCase() : `#${trimmed.toLowerCase()}`;
}

async function readStoredTeams() {
  try {
    const raw = await fsPromises.readFile(TEAM_STORE_FILE, "utf-8");
    if (!raw.trim()) return [] as StoredTeam[];
    const parsed = JSON.parse(raw) as unknown;
    const validated = storedTeamsSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn("[teams] Invalid team store payload, resetting to empty list");
      return [] as StoredTeam[];
    }
    return validated.data;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [] as StoredTeam[];
    }
    throw error;
  }
}

async function writeStoredTeams(teams: StoredTeam[]) {
  await fsPromises.mkdir(TEAM_STORE_DIR, { recursive: true });
  await fsPromises.writeFile(TEAM_STORE_FILE, `${JSON.stringify(teams, null, 2)}\n`, "utf-8");
}

function mapTeamDto(team: StoredTeam, techniciansById: Map<number, TeamMemberDto>) {
  const members = team.memberIds
    .map((memberId) => techniciansById.get(memberId))
    .filter((member): member is TeamMemberDto => Boolean(member));
  return {
    id: team.id,
    name: team.name,
    color: normalizeTeamColor(team.color),
    memberIds: team.memberIds,
    members,
    memberCount: members.length,
    isActive: team.isActive,
    capacityPerDay: team.capacityPerDay ?? null,
    notes: team.notes ?? null,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt
  };
}

function uniquePositiveIntIds(values: number[]) {
  const deduped = new Set<number>();
  for (const value of values) {
    if (Number.isInteger(value) && value > 0) {
      deduped.add(value);
    }
  }
  return [...deduped];
}

async function resolveAttachmentForDownload(attachmentId: string): Promise<ResolvedAttachmentDownload | null> {
  const [interventionAttachment, workReportAttachment] = await Promise.all([
    prisma.interventionAttachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        mimeType: true,
        originalName: true,
        storedName: true,
        interventionId: true,
        intervention: { select: { technicianId: true, secondaryTechnicianId: true } }
      }
    }),
    prisma.workReportAttachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        mimeType: true,
        originalName: true,
        storedName: true,
        workReport: {
          select: {
            interventionId: true,
            intervention: { select: { technicianId: true, secondaryTechnicianId: true } }
          }
        }
      }
    })
  ]);

  if (interventionAttachment && workReportAttachment) {
    console.warn(`[attachments] duplicate id found in both tables id=${attachmentId}; using intervention attachment`);
  }

  if (interventionAttachment) {
    return {
      id: interventionAttachment.id,
      source: "intervention",
      interventionId: interventionAttachment.interventionId,
      storedName: interventionAttachment.storedName,
      mimeType: interventionAttachment.mimeType,
      originalName: interventionAttachment.originalName,
      access: interventionAttachment.intervention
    };
  }

  if (workReportAttachment) {
    return {
      id: workReportAttachment.id,
      source: "workReport",
      interventionId: workReportAttachment.workReport.interventionId,
      storedName: workReportAttachment.storedName,
      mimeType: workReportAttachment.mimeType,
      originalName: workReportAttachment.originalName,
      access: workReportAttachment.workReport.intervention
    };
  }

  return null;
}

// Schemas
const interventionSchema = z.object({
  title: z.string().trim().min(1, "Il titolo è obbligatorio"),
  description: z.string().trim().optional(),
  address: z.string().trim().min(1, "L'indirizzo è obbligatorio"),
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'NO_SHOW']).default('SCHEDULED'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  startAt: z.string().optional().nullable(), // ISO string
  endAt: z.string().optional().nullable(),   // ISO string
  technicianId: z.number().nullable().optional(),
  secondaryTechnicianId: z.number().nullable().optional(),
  jobId: z.string().uuid().optional(),
  customerId: z.string().nullable().optional(),
  customerNameSnapshot: z.string().nullable().optional(),
  customerEmailSnapshot: z.string().nullable().optional(),
  customerPhoneSnapshot: z.string().nullable().optional(),
  customerAddressSnapshot: z.string().nullable().optional(),
  media: z.array(z.object({
    url: z.string()
      .max(2000, "URL troppo lungo")
      .refine(val => {
        if (val.startsWith('data:')) return false;
        if (val.startsWith('http://') || val.startsWith('https://')) return true;
        if (val.startsWith('/uploads/')) return true;
        return false;
      }, "Solo URL http/https o path /uploads/ consentiti (no Base64)"),
    type: z.enum(['image', 'video'])
  })).optional()
});

const UpdateInterventionSchema = interventionSchema.partial().extend({
  version: z.number().optional()
});

const duplicateInterventionSchema = z.object({
  technicianId: z.number().int().nullable().optional(),
  secondaryTechnicianId: z.number().int().nullable().optional()
}).strict();

const workReportUpdateSchema = z.object({
  workPerformed: z.string().trim().max(10000).optional().nullable(),
  extraWork: z.string().trim().max(10000).optional().nullable(),
  materials: z.string().trim().max(10000).optional().nullable(),
  customerName: z.string().trim().max(200).optional().nullable(),
  customerEmail: z.string().trim().email().optional().or(z.literal('')).nullable(),
  actualMinutes: z.union([z.number(), z.string().trim()]).optional().nullable(),
}).strict();

const MAX_MANUAL_ACTUAL_MINUTES = 10_080;

function normalizeManualActualMinutes(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;

  let numericValue: number;
  if (typeof value === "number") {
    numericValue = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw { status: 400, message: "actualMinutes non valido" };
    }
    numericValue = Number(trimmed);
  } else {
    throw { status: 400, message: "actualMinutes non valido" };
  }

  if (!Number.isFinite(numericValue)) {
    throw { status: 400, message: "actualMinutes non valido" };
  }

  const normalized = Math.floor(numericValue);
  if (normalized < 0) {
    throw { status: 400, message: "actualMinutes deve essere >= 0" };
  }
  if (normalized > MAX_MANUAL_ACTUAL_MINUTES) {
    throw { status: 400, message: "actualMinutes troppo grande (max " + MAX_MANUAL_ACTUAL_MINUTES + ")" };
  }

  return normalized;
}

async function getOrCreateWorkReport(tx: Prisma.TransactionClient, interventionId: number) {
  const existing = await tx.workReport.findUnique({ where: { interventionId } });
  if (existing) return existing;

  let retries = 2;
  while (retries >= 0) {
    try {
      const max = await tx.workReport.aggregate({ _max: { reportNumber: true } });
      const next = (max._max.reportNumber ?? -1) + 1;
      return await tx.workReport.create({
        data: { interventionId, reportNumber: next }
      });
    } catch (err: any) {
      if (err.code === 'P2002' && retries > 0) {
        retries -= 1;
        continue;
      }
      throw err;
    }
  }
  throw new Error('Impossibile creare il work report');
}

function getAutomaticWorkReportStartAt(interventionStartAt: Date | null | undefined, now: Date) {
  if (interventionStartAt && interventionStartAt.getTime() <= now.getTime()) {
    return interventionStartAt;
  }
  return now;
}

function getAutomaticTimingPatch(params: {
  report: {
    actualStartAt: Date | null;
    actualEndAt: Date | null;
    clientStartAt: Date | null;
    clientEndAt: Date | null;
    pauseStartAt: Date | null;
    pausedMinutes: number;
  };
  interventionStartAt: Date | null | undefined;
  now: Date;
  finalize: boolean;
}) {
  const { report, interventionStartAt, now, finalize } = params;
  const shouldSetStart = !report.actualStartAt;
  const shouldSetEnd = finalize && !report.actualEndAt;
  if (!shouldSetStart && !shouldSetEnd) return null;

  const actualStartAt = report.actualStartAt ?? getAutomaticWorkReportStartAt(interventionStartAt, now);
  const actualEndAt = shouldSetEnd ? now : report.actualEndAt;
  const patch: {
    actualStartAt?: Date;
    actualEndAt?: Date;
    clientStartAt?: Date;
    clientEndAt?: Date;
    pausedMinutes?: number;
    pauseStartAt?: null;
    actualMinutes?: number;
  } = {};

  if (shouldSetStart) {
    patch.actualStartAt = actualStartAt;
    if (!report.clientStartAt) {
      patch.clientStartAt = actualStartAt;
    }
  }

  if (shouldSetEnd && actualEndAt) {
    const timing = computeStoppedWorkReportMinutes({
      actualStartAt,
      actualEndAt,
      pausedMinutes: Math.max(0, Math.floor(Number(report.pausedMinutes || 0))),
      pauseStartAt: report.pauseStartAt
    });
    patch.actualEndAt = actualEndAt;
    if (!report.clientEndAt) {
      patch.clientEndAt = actualEndAt;
    }
    patch.actualMinutes = timing.actualMinutes;
    patch.pausedMinutes = timing.pausedMinutes;
    patch.pauseStartAt = null;
  }

  return patch;
}

const WORK_REPORT_TIMING_CONFLICT_MESSAGE = "Work report was updated by another client. Refresh and retry.";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const isProduction = process.env.NODE_ENV === "production";
  const isTruthyEnv = (value: string | undefined) => ["1", "true", "yes"].includes(String(value ?? "").trim().toLowerCase());
  const TRUST_PROXY_ENABLED = isTruthyEnv(process.env.TRUST_PROXY);
  if (isProduction && !TRUST_PROXY_ENABLED) {
    console.error("Refusing to start in production without TRUST_PROXY=1 (or true/yes). Required behind Nginx for correct client IP and rate limiting.");
    process.exit(1);
  }
  if (TRUST_PROXY_ENABLED) {
    app.set("trust proxy", 1);
  }

  const corsAllowCredentialsRaw = String(process.env.CORS_ALLOW_CREDENTIALS ?? "true").toLowerCase();
  const CORS_ALLOW_CREDENTIALS = !["0", "false", "no"].includes(corsAllowCredentialsRaw);
  const CORS_ALLOWED_ORIGINS = String(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const BODY_JSON_LIMIT = process.env.BODY_JSON_LIMIT || (isProduction ? "1mb" : "5mb");
  const BODY_URLENCODED_LIMIT = process.env.BODY_URLENCODED_LIMIT || (isProduction ? "1mb" : "5mb");

  const isAllowedCorsOrigin = (origin: string) => {
    if (CORS_ALLOWED_ORIGINS.length > 0) {
      return CORS_ALLOWED_ORIGINS.includes(origin);
    }
    if (isProduction) return false;
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  };
  await fsPromises.mkdir(UPLOAD_DIR, { recursive: true });

  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    next();
  });

  const requestLogger: express.RequestHandler = (req, res, next) => {
    const start = Date.now();
    const { method, originalUrl } = req;
    const requestId = req.requestId;
    const ip = req.ip;

    res.on("finish", () => {
      const duration = Date.now() - start;
      const user = req.user;
      const userId = user?.id ?? null;
      const role = user?.role ?? null;
      const logLine = {
        requestId,
        method,
        path: originalUrl,
        status: res.statusCode,
        durationMs: duration,
        ip,
        userId,
        role
      };

      if (res.statusCode >= 500) {
        console.error("[request]", JSON.stringify(logLine));
      } else {
        console.log("[request]", JSON.stringify(logLine));
      }
    });

    next();
  };
  app.use(requestLogger);
  app.use((req, res, next) => {
    const originHeader = req.headers.origin;
    const origin = typeof originHeader === "string" ? originHeader : "";
    const allowOrigin = origin ? isAllowedCorsOrigin(origin) : false;

    if (allowOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-API-Token");
      res.setHeader("Access-Control-Allow-Credentials", CORS_ALLOW_CREDENTIALS ? "true" : "false");
    }

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    if (req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
    next();
  });

  if (isProduction) {
    try {
      const compressionModuleName = "compression";
      const compressionModule = await import(compressionModuleName);
      const compressionMiddlewareFactory = (compressionModule as any).default ?? compressionModule;
      app.use(compressionMiddlewareFactory({ threshold: 1024 }));
    } catch (error) {
      console.warn("[startup] compression middleware non disponibile, avvio senza compression");
    }
  }

  // Limiti body env-driven (non applicati ai multipart gestiti da multer)
  app.use(express.json({ limit: BODY_JSON_LIMIT }));
  app.use(express.urlencoded({ limit: BODY_URLENCODED_LIMIT, extended: true }));

  // API Rate Limiting
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { error: "Troppe richieste. Riprova più tardi." }
  });
  app.use("/api/", apiLimiter);

  const publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: { error: "Troppi tentativi, riprova più tardi." }
  });
  app.use("/api/public/", publicLimiter);

  const publicSignGetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: "Troppe richieste. Riprova più tardi." }
  });

  const publicSignPostLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: "Troppe richieste. Riprova più tardi." }
  });

  // AUTH CONFIG
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    console.error("ERRORE CRITICO: Variabile d'ambiente JWT_SECRET mancante.");
    process.exit(1);
  }

  const ACCESS_TOKEN_TTL_MINUTES = Number(process.env.ACCESS_TOKEN_TTL_MINUTES || 15);
  const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
  const ALLOW_DEMO_TOKEN = isTruthyEnv(process.env.ALLOW_DEMO_TOKEN);
  const DEMO_API_TOKEN = String(process.env.DEMO_API_TOKEN ?? "").trim();
  if (isProduction && ALLOW_DEMO_TOKEN) {
    console.error("[startup] Refusing to start: ALLOW_DEMO_TOKEN is not allowed in production. Set ALLOW_DEMO_TOKEN=false.");
    process.exit(1);
  }
  if (isProduction && DEMO_API_TOKEN) {
    console.error("[startup] Refusing to start: DEMO_API_TOKEN must not be set in production. Remove DEMO_API_TOKEN from environment.");
    process.exit(1);
  }
  const SIGN_TOKEN_TTL_HOURS_RAW = Number(process.env.SIGN_TOKEN_TTL_HOURS ?? 168);
  const SIGN_TOKEN_TTL_HOURS =
    Number.isFinite(SIGN_TOKEN_TTL_HOURS_RAW) && SIGN_TOKEN_TTL_HOURS_RAW > 0
      ? SIGN_TOKEN_TTL_HOURS_RAW
      : 168;
  const WORK_REPORT_EMAIL_ENABLED = process.env.WORK_REPORT_EMAIL_ENABLED === 'true';

  const signAccessToken = (user: AuthUser) => {
    return jwt.sign(
      { role: user.role, technicianId: user.technicianId },
      JWT_SECRET,
      { subject: String(user.id), expiresIn: `${ACCESS_TOKEN_TTL_MINUTES}m` }
    );
  };

  const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

  const createRefreshToken = async (userId: number) => {
    const token = randomBytes(48).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: { tokenHash, userId, expiresAt }
    });
    return token;
  };

  const getTokenFromRequest = (req: express.Request) => {
    const authHeader = req.headers.authorization;
    const xApiToken = req.headers['x-api-token'];

    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.split(" ")[1];
    }
    if (typeof xApiToken === 'string') {
      return xApiToken;
    }
    return undefined;
  };

  const requireAuth: express.RequestHandler = (req, res, next) => {
    const token = getTokenFromRequest(req);
    if (!token) {
      return sendError(res, 401, "Non autorizzato", "UNAUTHORIZED");
    }

    if (ALLOW_DEMO_TOKEN && DEMO_API_TOKEN && token === DEMO_API_TOKEN) {
      req.user = { id: 0, role: Role.ADMIN, technicianId: null };
      return next();
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET) as JwtPayload & { role?: Role; technicianId?: number | null };
      const role = payload.role;
      if (!role || !Object.values(Role).includes(role) || typeof payload.sub !== 'string') {
        return sendError(res, 401, "Non autorizzato", "UNAUTHORIZED");
      }
      req.user = {
        id: Number(payload.sub),
        role,
        technicianId: payload.technicianId ?? null
      };
      return next();
    } catch (err) {
      return sendError(res, 401, "Non autorizzato", "UNAUTHORIZED");
    }
  };

  const requireRole = (...roles: Role[]) => {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!req.user || !roles.includes(req.user.role)) {
        return sendError(res, 403, "Non autorizzato", "FORBIDDEN");
      }
      next();
    };
  };

  const allowAdmin = requireRole(Role.ADMIN);
  const allowDispatcher = requireRole(Role.ADMIN, Role.DISPATCHER);
  const allowTech = requireRole(Role.ADMIN, Role.DISPATCHER, Role.TECHNICIAN);
  const attachmentUploadLimiter = rateLimit({
    windowMs: ATTACHMENT_UPLOAD_RATE_LIMIT_WINDOW_MS,
    max: ATTACHMENT_UPLOAD_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ? `u:${req.user.id}` : `ip:${ipKeyGenerator(req.ip || "")}`,
    handler: (_req, res) => {
      res.setHeader("Retry-After", String(Math.ceil(ATTACHMENT_UPLOAD_RATE_LIMIT_WINDOW_MS / 1000)));
      return sendError(res, 429, "Troppe richieste upload. Riprova più tardi.", "RATE_LIMITED");
    }
  });

  const attachmentStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, buildStoredAttachmentName(file.originalname))
  });
  const attachmentUpload = multer({
    storage: attachmentStorage,
    limits: {
      fileSize: ATTACHMENT_MAX_FILE_SIZE_BYTES,
      files: ATTACHMENT_MAX_FILES
    },
    fileFilter: (_req, file, cb) => {
      if (!isAllowedAttachmentMimeAndExtension(file.mimetype || "", file.originalname || "")) {
        cb(buildUploadValidationError("Tipo file non supportato", 415, "UNSUPPORTED_FILE_TYPE"));
        return;
      }
      cb(null, true);
    }
  });

  const handleMulterArray = (fieldName: string): express.RequestHandler => (req, res, next) => {
    attachmentUpload.array(fieldName, ATTACHMENT_MAX_FILES)(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return sendError(res, 413, "File troppo grande", "FILE_TOO_LARGE");
        }
        if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_PART_COUNT") {
          return sendError(res, 413, "Troppi file caricati", "TOO_MANY_FILES");
        }
        return sendError(res, 400, "Upload non valido", "INVALID_UPLOAD");
      }
      const customStatus = (err as Error & { status?: number })?.status;
      if (customStatus) {
        return sendError(res, customStatus, (err as Error)?.message || "Upload non valido", "INVALID_UPLOAD");
      }
      return sendError(res, 400, (err as Error)?.message || "Upload non valido", "INVALID_UPLOAD");
    });
  };

  const allowedStatusTransitions: Record<InterventionStatus, InterventionStatus[]> = {
    SCHEDULED: [InterventionStatus.SCHEDULED, InterventionStatus.IN_PROGRESS, InterventionStatus.CANCELLED, InterventionStatus.FAILED, InterventionStatus.NO_SHOW],
    IN_PROGRESS: [InterventionStatus.IN_PROGRESS, InterventionStatus.COMPLETED, InterventionStatus.FAILED, InterventionStatus.CANCELLED],
    COMPLETED: [InterventionStatus.COMPLETED],
    FAILED: [InterventionStatus.FAILED, InterventionStatus.SCHEDULED],
    CANCELLED: [InterventionStatus.CANCELLED, InterventionStatus.SCHEDULED],
    NO_SHOW: [InterventionStatus.NO_SHOW, InterventionStatus.SCHEDULED]
  };

  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/public/") || req.path === "/health" || req.path.startsWith("/auth/")) {
      return next();
    }
    return requireAuth(req, res, next);
  });

  // --- Push Notifications Config ---
  const VAPID_PUBLIC_KEY = process.env.VITE_VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:test@example.com";

  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log("✅ Web Push VAPID Configured");
  }

  // Funzione Helper per push ai tecnici
  const notifyTechnician = async (technicianId: number, title: string, body: string, url: string = '/') => {
    try {
      const subs = await prisma.pushSubscription.findMany({ where: { technicianId } });
      const payload = JSON.stringify({ title, body, url });

      for (const sub of subs) {
        try {
          await webpush.sendNotification({
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          }, payload);
        } catch (err: any) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await prisma.pushSubscription.delete({ where: { id: sub.id } });
          }
        }
      }
    } catch (e) {
      console.error('Error in notifyTechnician', e);
    }
  };

  // --- API Routes ---

  // GET /api/health (public)
  app.get("/api/health", async (req, res) => {
    try {
      await prisma.technician.count();
      res.json({ ok: true, db: true });
    } catch (error: any) {
      res.json({ ok: true, db: false, error: error?.message || 'DB error' });
    }
  });

  // AUTH ROUTES (public)
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { identifier, password } = req.body || {};
      if (!identifier || !password) {
        return res.status(400).json({ ok: false, error: "Credenziali mancanti" });
      }

      const normalizedIdentifier = String(identifier).trim();
      let user = await prisma.user.findFirst({
        where: {
          isActive: true,
          email: { equals: normalizedIdentifier, mode: 'insensitive' }
        }
      });
      if (!user) {
        user = await prisma.user.findFirst({
          where: {
            isActive: true,
            username: { equals: normalizedIdentifier, mode: 'insensitive' }
          }
        });
      }
      if (!user) {
        user = await prisma.user.findFirst({
          where: {
            isActive: true,
            phone: normalizedIdentifier
          }
        });
      }

      if (!user) {
        return res.status(401).json({ ok: false, error: "Credenziali non valide" });
      }

      const valid = await bcrypt.compare(String(password), user.passwordHash);
      if (!valid) {
        return res.status(401).json({ ok: false, error: "Credenziali non valide" });
      }

      const authUser: AuthUser = { id: user.id, role: user.role, technicianId: user.technicianId ?? null };
      const accessToken = signAccessToken(authUser);
      const refreshToken = await createRefreshToken(user.id);

      res.json({
        ok: true,
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          technicianId: user.technicianId ?? null
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: "Login fallito" });
    }
  });

  app.post("/api/auth/refresh", async (req, res) => {
    try {
      const { refreshToken } = req.body || {};
      if (!refreshToken) {
        return res.status(400).json({ ok: false, error: "Refresh token mancante" });
      }

      const tokenHash = hashToken(String(refreshToken));
      const stored = await prisma.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: true }
      });

      if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
        return res.status(401).json({ ok: false, error: "Refresh token non valido" });
      }
      if (!stored.user?.isActive) {
        return res.status(401).json({ ok: false, error: "Utente non attivo" });
      }

      await prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() }
      });

      const newRefreshToken = await createRefreshToken(stored.userId);
      const accessToken = signAccessToken({
        id: stored.userId,
        role: stored.user.role,
        technicianId: stored.user.technicianId ?? null
      });

      res.json({ ok: true, accessToken, refreshToken: newRefreshToken });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: "Refresh fallito" });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const { refreshToken } = req.body || {};
      if (refreshToken) {
        const tokenHash = hashToken(String(refreshToken));
        await prisma.refreshToken.updateMany({
          where: { tokenHash },
          data: { revokedAt: new Date() }
        });
      }
      res.json({ ok: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: "Logout fallito" });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ ok: false, error: "Non autorizzato" });
      if (req.user.id === 0) {
        return res.json({ ok: true, user: req.user });
      }
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, name: true, role: true, technicianId: true, isActive: true }
      });
      if (!user || !user.isActive) {
        return res.status(401).json({ ok: false, error: "Non autorizzato" });
      }
      res.json({ ok: true, user: { id: user.id, name: user.name, role: user.role, technicianId: user.technicianId ?? null } });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: "Failed to fetch user" });
    }
  });

  const userPublicSelect = {
    id: true,
    name: true,
    username: true,
    email: true,
    role: true,
    isActive: true,
    technicianId: true,
    createdAt: true,
    updatedAt: true
  } as const;

  const LAST_ADMIN_BLOCK_MESSAGE = "Operazione non consentita: è richiesto almeno un utente ADMIN.";
  const LAST_ACTIVE_ADMIN_BLOCK_MESSAGE = "Operazione non consentita: è richiesto almeno un utente ADMIN attivo.";

  // --- USERS (ADMIN) ---
  app.get("/api/users", allowAdmin, async (req, res) => {
    try {
      const users = await prisma.user.findMany({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: userPublicSelect
      });
      return res.json(users);
    } catch (error) {
      logApiError(req, error);
      return sendError(res, 500, "Errore caricamento utenti", "USERS_FETCH_FAILED");
    }
  });

  app.post("/api/users", allowAdmin, async (req, res) => {
    try {
      const parsed = userCreateSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return sendError(res, 400, "Dati utente non validi", "VALIDATION_ERROR", { details: parsed.error.flatten() });
      }

      const username = normalizeUsername(parsed.data.username);
      if (!USERNAME_PATTERN.test(username)) {
        return sendError(res, 400, "Username non valido", "INVALID_USERNAME");
      }
      const email = normalizeLoginEmail(parsed.data.email);
      const passwordHash = await bcrypt.hash(parsed.data.password, 10);

      const created = await prisma.user.create({
        data: {
          name: parsed.data.name?.trim() || username,
          username,
          email,
          passwordHash,
          role: parsed.data.role,
          isActive: parsed.data.isActive ?? true
        },
        select: userPublicSelect
      });

      return res.status(201).json(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const target = Array.isArray(error.meta?.target)
          ? error.meta.target.map((value) => String(value).toLowerCase())
          : [];
        if (target.some((value) => value.includes("username"))) {
          return sendError(res, 409, "Username già in uso", "USERNAME_ALREADY_EXISTS");
        }
        if (target.some((value) => value.includes("email"))) {
          return sendError(res, 409, "Email già in uso", "EMAIL_ALREADY_EXISTS");
        }
      }
      logApiError(req, error);
      return sendError(res, 500, "Errore creazione utente", "USER_CREATE_FAILED");
    }
  });

  app.patch("/api/users/:id", allowAdmin, async (req, res) => {
    try {
      const userId = Number(req.params.id);
      if (!Number.isInteger(userId) || userId <= 0) {
        return sendError(res, 400, "ID utente non valido", "INVALID_USER_ID");
      }

      const parsed = userPatchSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return sendError(res, 400, "Dati utente non validi", "VALIDATION_ERROR", { details: parsed.error.flatten() });
      }

      const existing = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true }
      });
      if (!existing) {
        return sendError(res, 404, "Utente non trovato", "USER_NOT_FOUND");
      }

      const nextRole = parsed.data.role ?? existing.role;
      const nextIsActive = parsed.data.isActive ?? existing.isActive;
      const isRoleDemotionFromAdmin = existing.role === Role.ADMIN && nextRole !== Role.ADMIN;
      const isRemovingActiveAdmin =
        existing.role === Role.ADMIN &&
        existing.isActive &&
        (isRoleDemotionFromAdmin || !nextIsActive);

      if (isRoleDemotionFromAdmin) {
        const adminsCount = await prisma.user.count({ where: { role: Role.ADMIN } });
        if (adminsCount <= 1) {
          return sendError(res, 409, LAST_ADMIN_BLOCK_MESSAGE, "LAST_ADMIN_REQUIRED");
        }
      }
      if (isRemovingActiveAdmin) {
        const activeAdminsCount = await prisma.user.count({
          where: { role: Role.ADMIN, isActive: true }
        });
        if (activeAdminsCount <= 1) {
          return sendError(res, 409, LAST_ACTIVE_ADMIN_BLOCK_MESSAGE, "LAST_ACTIVE_ADMIN_REQUIRED");
        }
      }

      const data: Prisma.UserUpdateInput = {};
      if (parsed.data.username !== undefined) {
        const username = normalizeUsername(parsed.data.username);
        if (!USERNAME_PATTERN.test(username)) {
          return sendError(res, 400, "Username non valido", "INVALID_USERNAME");
        }
        data.username = username;
      }
      if (parsed.data.email !== undefined) {
        data.email = normalizeLoginEmail(parsed.data.email);
      }
      if (parsed.data.role !== undefined) {
        data.role = parsed.data.role;
      }
      if (parsed.data.isActive !== undefined) {
        data.isActive = parsed.data.isActive;
      }
      if (parsed.data.name !== undefined) {
        data.name = parsed.data.name.trim();
      }
      if (parsed.data.password !== undefined) {
        const password = parsed.data.password.trim();
        if (password) {
          if (password.length < 8) {
            return sendError(res, 400, "Password troppo corta (minimo 8 caratteri)", "INVALID_PASSWORD");
          }
          data.passwordHash = await bcrypt.hash(password, 10);
        }
      }
      if (Object.keys(data).length === 0) {
        return sendError(res, 400, "Nessuna modifica da applicare", "NO_UPDATES");
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data,
        select: userPublicSelect
      });

      return res.json(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const target = Array.isArray(error.meta?.target)
          ? error.meta.target.map((value) => String(value).toLowerCase())
          : [];
        if (target.some((value) => value.includes("username"))) {
          return sendError(res, 409, "Username già in uso", "USERNAME_ALREADY_EXISTS");
        }
        if (target.some((value) => value.includes("email"))) {
          return sendError(res, 409, "Email già in uso", "EMAIL_ALREADY_EXISTS");
        }
      }
      logApiError(req, error);
      return sendError(res, 500, "Errore aggiornamento utente", "USER_UPDATE_FAILED");
    }
  });

  app.delete("/api/users/:id", allowAdmin, async (req, res) => {
    try {
      const userId = Number(req.params.id);
      if (!Number.isInteger(userId) || userId <= 0) {
        return sendError(res, 400, "ID utente non valido", "INVALID_USER_ID");
      }

      const existing = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true }
      });
      if (!existing) {
        return sendError(res, 404, "Utente non trovato", "USER_NOT_FOUND");
      }

      if (existing.role === Role.ADMIN) {
        const adminsCount = await prisma.user.count({ where: { role: Role.ADMIN } });
        if (adminsCount <= 1) {
          return sendError(res, 409, LAST_ADMIN_BLOCK_MESSAGE, "LAST_ADMIN_REQUIRED");
        }
        if (existing.isActive) {
          const activeAdminsCount = await prisma.user.count({
            where: { role: Role.ADMIN, isActive: true }
          });
          if (activeAdminsCount <= 1) {
            return sendError(res, 409, LAST_ACTIVE_ADMIN_BLOCK_MESSAGE, "LAST_ACTIVE_ADMIN_REQUIRED");
          }
        }
      }

      await prisma.user.delete({ where: { id: userId } });
      return res.json({ ok: true });
    } catch (error) {
      logApiError(req, error);
      return sendError(res, 500, "Errore eliminazione utente", "USER_DELETE_FAILED");
    }
  });

  // GET /api/technicians
  app.get("/api/technicians", allowDispatcher, async (req, res) => {
    try {
      const technicians = await prisma.technician.findMany({
        where: { isActive: true },
      });
      res.json(technicians);
    } catch (error) {
      res.status(500).json({ ok: false, error: "Failed to fetch technicians" });
    }
  });

  // POST /api/technicians
  app.post("/api/technicians", allowDispatcher, async (req, res) => {
    try {
      const parsed = technicianCreateSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "Dati impiegato non validi",
          details: parsed.error.flatten()
        });
      }

      const created = await prisma.technician.create({
        data: {
          name: parsed.data.name.trim(),
          email: parsed.data.email?.trim() || null,
          phone: parsed.data.phone?.trim() || null,
          skills: parsed.data.skills?.trim() || "",
          color: normalizeTeamColor(parsed.data.color || "#3b82f6"),
          isActive: parsed.data.isActive ?? true
        }
      });

      return res.status(201).json(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const target = Array.isArray(error.meta?.target) ? error.meta.target : [];
        if (target.includes("email")) {
          return sendError(res, 409, "Email già in uso", "EMAIL_ALREADY_EXISTS");
        }
      }
      logApiError(req, error);
      return sendError(res, 500, "Errore creazione impiegato", "TECHNICIAN_CREATE_FAILED");
    }
  });

  // PATCH /api/technicians/:id
  app.patch("/api/technicians/:id", allowDispatcher, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { color } = req.body;
      const technician = await prisma.technician.update({
        where: { id },
        data: { color }
      });
      res.json(technician);
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: "Failed to update technician color" });
    }
  });

  // --- TEAMS ---

  app.get('/api/teams', allowDispatcher, async (req, res) => {
    try {
      const [teams, technicians] = await Promise.all([
        readStoredTeams(),
        prisma.technician.findMany({
          where: { isActive: true },
          select: { id: true, name: true, color: true, isActive: true }
        })
      ]);
      const techniciansById = new Map<number, TeamMemberDto>(
        technicians.map((technician) => [
          technician.id,
          {
            id: technician.id,
            name: technician.name,
            color: technician.color,
            isActive: technician.isActive
          }
        ])
      );
      const payload = teams
        .map((team) => mapTeamDto(team, techniciansById))
        .sort((a, b) => a.name.localeCompare(b.name, 'it'));
      res.json(payload);
    } catch (error) {
      logApiError(req, error);
      res.status(500).json({ error: 'Errore caricamento squadre' });
    }
  });

  app.post('/api/teams', allowDispatcher, async (req, res) => {
    try {
      const parsed = teamCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Dati squadra non validi', details: parsed.error.flatten() });
      }

      const [teams, technicians] = await Promise.all([
        readStoredTeams(),
        prisma.technician.findMany({
          where: { isActive: true },
          select: { id: true, name: true, color: true, isActive: true }
        })
      ]);
      const techniciansById = new Map<number, TeamMemberDto>(
        technicians.map((technician) => [
          technician.id,
          {
            id: technician.id,
            name: technician.name,
            color: technician.color,
            isActive: technician.isActive
          }
        ])
      );

      const normalizedName = parsed.data.name.trim().toLowerCase();
      const duplicateName = teams.some((team) => team.name.trim().toLowerCase() === normalizedName);
      if (duplicateName) {
        return res.status(409).json({ error: 'Esiste già una squadra con questo nome' });
      }

      const memberIds = uniquePositiveIntIds(parsed.data.memberIds || []);
      const invalidMemberIds = memberIds.filter((memberId) => !techniciansById.has(memberId));
      if (invalidMemberIds.length > 0) {
        return res.status(400).json({ error: 'Uno o più tecnici selezionati non sono disponibili' });
      }

      const nextId = teams.reduce((maxId, team) => Math.max(maxId, team.id), 0) + 1;
      const nowIso = new Date().toISOString();
      const nextTeam: StoredTeam = {
        id: nextId,
        name: parsed.data.name.trim(),
        color: normalizeTeamColor(parsed.data.color || '#3b82f6'),
        memberIds,
        isActive: parsed.data.isActive ?? true,
        capacityPerDay: parsed.data.capacityPerDay ?? null,
        notes: parsed.data.notes ?? null,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      await writeStoredTeams([...teams, nextTeam]);
      res.status(201).json(mapTeamDto(nextTeam, techniciansById));
    } catch (error) {
      logApiError(req, error);
      res.status(500).json({ error: 'Errore creazione squadra' });
    }
  });

  app.patch('/api/teams/:id', allowDispatcher, async (req, res) => {
    try {
      const teamId = Number(req.params.id);
      if (!Number.isInteger(teamId) || teamId <= 0) {
        return res.status(400).json({ error: 'ID squadra non valido' });
      }

      const parsed = teamPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Dati squadra non validi', details: parsed.error.flatten() });
      }

      const [teams, technicians] = await Promise.all([
        readStoredTeams(),
        prisma.technician.findMany({
          where: { isActive: true },
          select: { id: true, name: true, color: true, isActive: true }
        })
      ]);

      const teamIndex = teams.findIndex((team) => team.id === teamId);
      if (teamIndex < 0) {
        return res.status(404).json({ error: 'Squadra non trovata' });
      }

      const techniciansById = new Map<number, TeamMemberDto>(
        technicians.map((technician) => [
          technician.id,
          {
            id: technician.id,
            name: technician.name,
            color: technician.color,
            isActive: technician.isActive
          }
        ])
      );

      if (typeof parsed.data.name === 'string') {
        const normalizedName = parsed.data.name.trim().toLowerCase();
        const duplicateName = teams.some((team) => team.id !== teamId && team.name.trim().toLowerCase() === normalizedName);
        if (duplicateName) {
          return res.status(409).json({ error: 'Esiste già una squadra con questo nome' });
        }
      }

      let nextMemberIds = teams[teamIndex].memberIds;
      if (Array.isArray(parsed.data.memberIds)) {
        nextMemberIds = uniquePositiveIntIds(parsed.data.memberIds);
        const invalidMemberIds = nextMemberIds.filter((memberId) => !techniciansById.has(memberId));
        if (invalidMemberIds.length > 0) {
          return res.status(400).json({ error: 'Uno o più tecnici selezionati non sono disponibili' });
        }
      }

      const updatedTeam: StoredTeam = {
        ...teams[teamIndex],
        ...(typeof parsed.data.name === 'string' ? { name: parsed.data.name.trim() } : {}),
        ...(typeof parsed.data.color === 'string' ? { color: normalizeTeamColor(parsed.data.color) } : {}),
        ...(typeof parsed.data.isActive === 'boolean' ? { isActive: parsed.data.isActive } : {}),
        ...(parsed.data.capacityPerDay !== undefined ? { capacityPerDay: parsed.data.capacityPerDay } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
        memberIds: nextMemberIds,
        updatedAt: new Date().toISOString()
      };

      const nextTeams = [...teams];
      nextTeams[teamIndex] = updatedTeam;
      await writeStoredTeams(nextTeams);
      res.json(mapTeamDto(updatedTeam, techniciansById));
    } catch (error) {
      logApiError(req, error);
      res.status(500).json({ error: 'Errore aggiornamento squadra' });
    }
  });

  app.delete('/api/teams/:id', allowDispatcher, async (req, res) => {
    try {
      const teamId = Number(req.params.id);
      if (!Number.isInteger(teamId) || teamId <= 0) {
        return res.status(400).json({ error: 'ID squadra non valido' });
      }

      const teams = await readStoredTeams();
      const teamIndex = teams.findIndex((team) => team.id === teamId);
      if (teamIndex < 0) {
        return res.status(404).json({ error: 'Squadra non trovata' });
      }

      const nextTeams = [...teams];
      nextTeams.splice(teamIndex, 1);
      await writeStoredTeams(nextTeams);
      res.status(204).end();
    } catch (error) {
      logApiError(req, error);
      res.status(500).json({ error: 'Errore eliminazione squadra' });
    }
  });

  app.get('/api/stats/overview', allowDispatcher, async (req, res) => {
    try {
      const fromRaw = typeof req.query.from === 'string' ? req.query.from : undefined;
      const toRaw = typeof req.query.to === 'string' ? req.query.to : undefined;
      const teamIdsRaw = typeof req.query.teamIds === 'string' ? req.query.teamIds : '';

      const to = toRaw ? new Date(toRaw) : new Date();
      if (Number.isNaN(to.getTime())) {
        return res.status(400).json({ error: 'Parametro "to" non valido' });
      }
      const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
      if (Number.isNaN(from.getTime())) {
        return res.status(400).json({ error: 'Parametro "from" non valido' });
      }
      if (from > to) {
        return res.status(400).json({ error: 'Intervallo date non valido' });
      }

      const selectedTeamIds = uniquePositiveIntIds(
        teamIdsRaw
          .split(',')
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      );

      const [storedTeams, interventionsInRange, backlogCurrent] = await Promise.all([
        readStoredTeams(),
        prisma.intervention.findMany({
          where: {
            OR: [
              {
                AND: [
                  { startAt: { lte: to } },
                  { endAt: { gte: from } }
                ]
              },
              {
                AND: [
                  { startAt: null },
                  { endAt: null },
                  { createdAt: { gte: from, lte: to } }
                ]
              }
            ]
          },
          select: {
            id: true,
            status: true,
            startAt: true,
            endAt: true,
            technicianId: true,
            secondaryTechnicianId: true,
            customerNameSnapshot: true,
            customer: { select: { id: true, name: true, companyName: true } },
            workReport: {
              select: {
                actualMinutes: true,
                workPerformed: true,
                extraWork: true,
                materials: true,
                signedAt: true,
                customerSignatureDataUrl: true
              }
            }
          }
        }),
        prisma.intervention.count({
          where: {
            status: InterventionStatus.SCHEDULED,
            technicianId: null
          }
        })
      ]);

      const teamIdToMemberIds = new Map<number, number[]>();
      const techIdToTeam = new Map<number, { id: number; name: string }>();
      for (const team of storedTeams) {
        teamIdToMemberIds.set(team.id, team.memberIds);
        for (const memberId of team.memberIds) {
          if (!techIdToTeam.has(memberId)) {
            techIdToTeam.set(memberId, { id: team.id, name: team.name });
          }
        }
      }

      const selectedTechIds = new Set<number>();
      for (const teamId of selectedTeamIds) {
        const members = teamIdToMemberIds.get(teamId) || [];
        for (const memberId of members) selectedTechIds.add(memberId);
      }

      const hasTeamFilter = selectedTeamIds.length > 0;
      const includeInterventionByTeam = (intervention: {
        technicianId: number | null;
        secondaryTechnicianId: number | null;
      }) => {
        if (!hasTeamFilter) return true;
        if (selectedTechIds.size === 0) return false;
        return (
          (intervention.technicianId !== null && selectedTechIds.has(intervention.technicianId)) ||
          (intervention.secondaryTechnicianId !== null && selectedTechIds.has(intervention.secondaryTechnicianId))
        );
      };

      const scopedInterventions = interventionsInRange.filter(includeInterventionByTeam);
      const scheduled = scopedInterventions.filter((intervention) => intervention.startAt && intervention.endAt);
      const completed = scopedInterventions.filter((intervention) => intervention.status === InterventionStatus.COMPLETED);
      const completionRate = scheduled.length > 0 ? Math.round((completed.length / scheduled.length) * 1000) / 10 : 0;

      const resolveTeam = (intervention: { technicianId: number | null; secondaryTechnicianId: number | null }) => {
        if (intervention.technicianId !== null) {
          const primaryTeam = techIdToTeam.get(intervention.technicianId);
          if (primaryTeam) return primaryTeam;
        }
        if (intervention.secondaryTechnicianId !== null) {
          const secondaryTeam = techIdToTeam.get(intervention.secondaryTechnicianId);
          if (secondaryTeam) return secondaryTeam;
        }
        if (intervention.technicianId !== null) {
          return { id: intervention.technicianId, name: `Tecnico #${intervention.technicianId}` };
        }
        if (intervention.secondaryTechnicianId !== null) {
          return { id: intervention.secondaryTechnicianId, name: `Tecnico #${intervention.secondaryTechnicianId}` };
        }
        return { id: 0, name: 'Non assegnati' };
      };

      const overlapGroups = new Map<number, Array<{ id: number; startMs: number; endMs: number }>>();
      for (const intervention of scheduled) {
        const startMs = intervention.startAt ? new Date(intervention.startAt).getTime() : NaN;
        const endMs = intervention.endAt ? new Date(intervention.endAt).getTime() : NaN;
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
        const team = resolveTeam(intervention);
        const group = overlapGroups.get(team.id) || [];
        group.push({ id: intervention.id, startMs, endMs });
        overlapGroups.set(team.id, group);
      }

      const conflictIds = new Set<number>();
      for (const group of overlapGroups.values()) {
        group.sort((a, b) => a.startMs - b.startMs);
        for (let i = 0; i < group.length; i += 1) {
          for (let j = i + 1; j < group.length; j += 1) {
            if (group[j].startMs >= group[i].endMs) break;
            if (group[i].startMs < group[j].endMs && group[i].endMs > group[j].startMs) {
              conflictIds.add(group[i].id);
              conflictIds.add(group[j].id);
            }
          }
        }
      }

      const totalWorkedMinutes = scopedInterventions.reduce((sum, intervention) => {
        const minutes = intervention.workReport?.actualMinutes ?? 0;
        return sum + (Number.isFinite(minutes) ? minutes : 0);
      }, 0);
      const isWorkReportCompiled = (workReport: {
        workPerformed: string | null;
        extraWork: string | null;
        materials: string | null;
        signedAt: Date | null;
        customerSignatureDataUrl: string | null;
      } | null | undefined) => {
        if (!workReport) return false;
        const workPerformed = (workReport.workPerformed ?? '').trim();
        const extraWork = (workReport.extraWork ?? '').trim();
        const materials = (workReport.materials ?? '').trim();
        const signatureData = (workReport.customerSignatureDataUrl ?? '').trim();
        return Boolean(
          workPerformed ||
          extraWork ||
          materials ||
          workReport.signedAt ||
          signatureData
        );
      };
      const workReportCompiled = scopedInterventions.reduce((count, intervention) => (
        isWorkReportCompiled(intervention.workReport) ? count + 1 : count
      ), 0);
      const workReportMissing = Math.max(0, scopedInterventions.length - workReportCompiled);

      const byCustomer = new Map<string, { name: string; count: number }>();
      for (const intervention of scopedInterventions) {
        const customerName =
          intervention.customer?.companyName ||
          intervention.customer?.name ||
          intervention.customerNameSnapshot ||
          'Cliente non specificato';
        const key = `${intervention.customer?.id || 'snapshot'}:${customerName}`;
        const existing = byCustomer.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          byCustomer.set(key, { name: customerName, count: 1 });
        }
      }
      const topCustomers = [...byCustomer.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

      const byTeam = new Map<string, { teamId: number; teamName: string; interventions: number; workedMinutes: number }>();
      for (const intervention of scopedInterventions) {
        const team = resolveTeam(intervention);
        const key = String(team.id);
        const existing = byTeam.get(key);
        const workedMinutes = intervention.workReport?.actualMinutes ?? 0;
        if (existing) {
          existing.interventions += 1;
          existing.workedMinutes += workedMinutes;
        } else {
          byTeam.set(key, {
            teamId: team.id,
            teamName: team.name,
            interventions: 1,
            workedMinutes
          });
        }
      }
      const loadByTeam = [...byTeam.values()].sort((a, b) => b.interventions - a.interventions);

      const statusCountsMap = new Map<InterventionStatus, number>();
      for (const intervention of scopedInterventions) {
        statusCountsMap.set(intervention.status, (statusCountsMap.get(intervention.status) || 0) + 1);
      }
      const statusCounts = [...statusCountsMap.entries()].map(([status, count]) => ({ status, count }));

      res.json({
        range: {
          from: from.toISOString(),
          to: to.toISOString()
        },
        selectedTeamIds,
        kpis: {
          plannedInterventions: scheduled.length,
          completedInterventions: completed.length,
          completionRate,
          backlogCurrent,
          plannerConflicts: conflictIds.size,
          totalWorkedMinutes,
          workReportCompiled,
          workReportMissing
        },
        topCustomers,
        loadByTeam,
        statusCounts
      });
    } catch (error) {
      logApiError(req, error);
      res.status(500).json({ error: 'Errore caricamento statistiche' });
    }
  });

  // --- INTERVENTIONS ---

  app.get('/api/interventions', allowTech, async (req, res) => {
    try {
      const { from, to, technicianId, status } = req.query;
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const customerQuery = typeof req.query.customer === "string" ? req.query.customer.trim() : "";
      const phoneQuery = typeof req.query.phone === "string" ? req.query.phone.trim() : "";
      const addressQuery = typeof req.query.address === "string" ? req.query.address.trim() : "";
      const dateFromQuery = typeof req.query.dateFrom === "string" ? req.query.dateFrom.trim() : "";
      const dateToQuery = typeof req.query.dateTo === "string" ? req.query.dateTo.trim() : "";
      const filterPresetRaw = typeof req.query.filterPreset === "string"
        ? req.query.filterPreset.trim().toUpperCase()
        : "ALL";
      const sortByRaw = typeof req.query.sortBy === "string" ? req.query.sortBy.trim() : "";
      const sortDir = req.query.sortDir === "asc" ? "asc" : "desc";
      const sortBy = (["statusPriority", "dateTime", "team", "address"] as const).includes(sortByRaw as any)
        ? (sortByRaw as "statusPriority" | "dateTime" | "team" | "address")
        : null;
      const rawLimit = Number(req.query.limit);
      const rawOffset = Number(req.query.offset);
      const hasExplicitPagination = typeof req.query.limit === "string" || typeof req.query.offset === "string";
      const isCalendarScopedFetch = Boolean(from && to) || req.query.backlog === "true";
      const shouldPaginate = hasExplicitPagination || !isCalendarScopedFetch;
      const take = shouldPaginate
        ? Math.min(500, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 200))
        : undefined;
      const skip = shouldPaginate
        ? Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0)
        : undefined;

      const where: Prisma.InterventionWhereInput = {};
      const andFilters: Prisma.InterventionWhereInput[] = [];
      const parseDateBoundary = (raw: string, endOfDay: boolean) => {
        const normalized = raw.trim();
        if (!normalized) return null;
        const parsed = new Date(endOfDay ? `${normalized}T23:59:59.999` : `${normalized}T00:00:00.000`);
        if (!Number.isFinite(parsed.getTime())) return null;
        return parsed;
      };
      const historicalDateFrom = dateFromQuery ? parseDateBoundary(dateFromQuery, false) : null;
      const historicalDateTo = dateToQuery ? parseDateBoundary(dateToQuery, true) : null;
      if (dateFromQuery && !historicalDateFrom) {
        return res.status(400).json({ ok: false, error: 'Parametro dateFrom non valido (usa YYYY-MM-DD)' });
      }
      if (dateToQuery && !historicalDateTo) {
        return res.status(400).json({ ok: false, error: 'Parametro dateTo non valido (usa YYYY-MM-DD)' });
      }
      if (historicalDateFrom && historicalDateTo && historicalDateFrom > historicalDateTo) {
        return res.status(400).json({ ok: false, error: 'Intervallo date non valido: dateFrom deve essere <= dateTo' });
      }

      if (req.user?.role === Role.TECHNICIAN) {
        if (!req.user.technicianId) {
          return res.status(403).json({ ok: false, error: "Non autorizzato" });
        }
        if (technicianId && Number(technicianId) !== req.user.technicianId) {
          return res.status(403).json({ ok: false, error: "Non autorizzato" });
        }
        where.OR = [
          { technicianId: req.user.technicianId },
          { secondaryTechnicianId: req.user.technicianId }
        ];
      } else if (technicianId) {
        where.OR = [
          { technicianId: Number(technicianId) },
          { secondaryTechnicianId: Number(technicianId) }
        ];
      }

      if (status) {
        where.status = String(status) as InterventionStatus;
      }

      if (from && to) {
        const fromDate = new Date(String(from));
        const toDate = new Date(String(to));
        andFilters.push(
          { startAt: { lte: toDate } },
          { endAt: { gte: fromDate } }
        );
      } else if (req.query.backlog === 'true') {
        where.status = 'SCHEDULED';
        where.technicianId = null;
      }

      if (q) {
        andFilters.push({
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { address: { contains: q, mode: "insensitive" } },
            { customerNameSnapshot: { contains: q, mode: "insensitive" } },
            { customerEmailSnapshot: { contains: q, mode: "insensitive" } },
            { customerPhoneSnapshot: { contains: q, mode: "insensitive" } },
            { customerAddressSnapshot: { contains: q, mode: "insensitive" } },
            {
              customer: {
                is: {
                  OR: [
                    { name: { contains: q, mode: "insensitive" } },
                    { companyName: { contains: q, mode: "insensitive" } },
                    { email: { contains: q, mode: "insensitive" } },
                    { phone1: { contains: q, mode: "insensitive" } },
                    { phone2: { contains: q, mode: "insensitive" } },
                    { addressLine: { contains: q, mode: "insensitive" } },
                    { physicalAddress: { contains: q, mode: "insensitive" } },
                    { intercomInfo: { contains: q, mode: "insensitive" } },
                    { intercomLabel: { contains: q, mode: "insensitive" } },
                    { notes: { contains: q, mode: "insensitive" } }
                  ]
                }
              }
            }
          ]
        });
      }

      if (customerQuery) {
        andFilters.push({
          OR: [
            { customerNameSnapshot: { contains: customerQuery, mode: "insensitive" } },
            {
              customer: {
                is: {
                  OR: [
                    { name: { contains: customerQuery, mode: "insensitive" } },
                    { companyName: { contains: customerQuery, mode: "insensitive" } }
                  ]
                }
              }
            }
          ]
        });
      }

      if (phoneQuery) {
        andFilters.push({
          OR: [
            { customerPhoneSnapshot: { contains: phoneQuery, mode: "insensitive" } },
            {
              customer: {
                is: {
                  OR: [
                    { phone1: { contains: phoneQuery, mode: "insensitive" } },
                    { phone2: { contains: phoneQuery, mode: "insensitive" } }
                  ]
                }
              }
            }
          ]
        });
      }

      if (addressQuery) {
        andFilters.push({
          OR: [
            { address: { contains: addressQuery, mode: "insensitive" } },
            { customerAddressSnapshot: { contains: addressQuery, mode: "insensitive" } },
            {
              customer: {
                is: {
                  OR: [
                    { addressLine: { contains: addressQuery, mode: "insensitive" } },
                    { physicalAddress: { contains: addressQuery, mode: "insensitive" } }
                  ]
                }
              }
            }
          ]
        });
      }

      if (historicalDateFrom || historicalDateTo) {
        const range: Prisma.DateTimeFilter = {};
        if (historicalDateFrom) range.gte = historicalDateFrom;
        if (historicalDateTo) range.lte = historicalDateTo;
        andFilters.push({ startAt: range });
      }

      if (filterPresetRaw === "TO_COMPLETE") {
        andFilters.push({
          OR: [
            { workReport: { is: null } },
            { workReport: { is: { signedAt: null } } }
          ]
        });
      } else if (filterPresetRaw === "TO_BILL") {
        andFilters.push({
          workReport: { is: { signedAt: { not: null } } }
        });
      }

      if (andFilters.length > 0) {
        where.AND = andFilters;
      }

      const orderBy: Prisma.InterventionOrderByWithRelationInput[] =
        sortBy === "dateTime"
          ? [{ startAt: sortDir }, { createdAt: sortDir }]
          : sortBy === "address"
            ? [{ address: sortDir }, { createdAt: sortDir }]
            : sortBy === "team"
              ? [{ technician: { name: sortDir } }, { createdAt: sortDir }]
              : [{ createdAt: "desc" }];

      const baseQuery = {
        where,
        include: {
          technician: { select: { id: true, name: true, color: true } },
          secondaryTechnician: { select: { id: true, name: true, color: true } },
          customer: {
            select: {
              id: true,
              name: true,
              companyName: true,
              email: true,
              phone1: true,
              phone2: true,
              customerType: true,
              preferredTimeSlot: true,
              addressLine: true,
              physicalAddress: true,
              intercomInfo: true,
              intercomLabel: true,
              city: true,
              notes: true
            }
          },
          workReport: { select: { id: true, reportNumber: true, emailedAt: true, signedAt: true, signatureRequestedAt: true } }
        },
        orderBy,
        ...(typeof skip === "number" ? { skip } : {}),
        ...(typeof take === "number" ? { take } : {})
      } satisfies Prisma.InterventionFindManyArgs;

      const normalized = (value: string | null | undefined) => (value || "").trim().toLocaleLowerCase("it");
      const getTeamLabel = (item: any) => (
        item.technician?.name || item.secondaryTechnician?.name || ""
      );
      let interventions: Awaited<ReturnType<typeof prisma.intervention.findMany>>;
      try {
        interventions = await prisma.intervention.findMany(baseQuery);
      } catch (error) {
        if (sortBy !== "team") {
          throw error;
        }
        const fallbackQuery = {
          ...baseQuery,
          orderBy: [{ createdAt: sortDir }]
        } satisfies Prisma.InterventionFindManyArgs;
        interventions = await prisma.intervention.findMany(fallbackQuery);
        interventions.sort((a, b) => {
          const diff = normalized(getTeamLabel(a)).localeCompare(normalized(getTeamLabel(b)), "it");
          if (diff !== 0) return sortDir === "asc" ? diff : -diff;
          return sortDir === "asc"
            ? a.createdAt.getTime() - b.createdAt.getTime()
            : b.createdAt.getTime() - a.createdAt.getTime();
        });
      }
      const getDateTs = (item: { startAt: Date | null; createdAt: Date }) => (
        item.startAt ? item.startAt.getTime() : item.createdAt.getTime()
      );

      if (sortBy) {
        const multiplier = sortDir === "asc" ? 1 : -1;
        const statusOrder: Record<string, number> = {
          IN_PROGRESS: 0,
          SCHEDULED: 1,
          COMPLETED: 2,
          FAILED: 3,
          NO_SHOW: 4,
          CANCELLED: 5
        };
        const priorityOrder: Record<string, number> = {
          URGENT: 0,
          HIGH: 1,
          MEDIUM: 2,
          LOW: 3
        };
        if (sortBy === "statusPriority") {
          interventions.sort((a, b) => {
            let diff = 0;
            const statusDiff = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
            if (statusDiff !== 0) diff = statusDiff;
            if (diff === 0) {
              diff = (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99);
            }
            if (diff === 0) {
              diff = getDateTs(a) - getDateTs(b);
            }

            if (diff !== 0) return diff * multiplier;
            return b.createdAt.getTime() - a.createdAt.getTime();
          });
        }
      }

      res.json(interventions);
    } catch (error) {
      logApiError(req, error);
      res.status(500).json({ ok: false, error: 'Errore durante il recupero degli interventi' });
    }
  });

  // GET /api/interventions/history-by-address
  app.get('/api/interventions/history-by-address', allowTech, async (req, res) => {
    try {
      const customerId = typeof req.query.customerId === "string" ? req.query.customerId.trim() : "";
      const addressKey = normalizeAddress(typeof req.query.addressKey === "string" ? req.query.addressKey : "");
      const rawLimit = Number(req.query.limit);
      const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.floor(rawLimit))) : 20;
      const coarseTokens = buildAddressSearchTokens(addressKey, 3);

      if (!customerId || !addressKey || coarseTokens.length === 0) {
        return res.status(400).json({
          ok: false,
          error: "Parametri customerId/addressKey non validi"
        });
      }

      const whereClause: Prisma.InterventionWhereInput = {
        customerId,
        AND: coarseTokens.map((token) => ({
          address: { contains: token, mode: "insensitive" }
        }))
      };
      if (req.user?.role === Role.TECHNICIAN) {
        if (!req.user.technicianId) {
          return res.status(403).json({ ok: false, error: "Non autorizzato" });
        }
        whereClause.OR = [
          { technicianId: req.user.technicianId },
          { secondaryTechnicianId: req.user.technicianId }
        ];
      }

      const rows = await prisma.intervention.findMany({
        where: whereClause,
        select: {
          id: true,
          title: true,
          startAt: true,
          endAt: true,
          status: true,
          priority: true,
          address: true,
          createdAt: true,
          technician: { select: { name: true } },
          secondaryTechnician: { select: { name: true } },
          workReport: {
            select: {
              signedAt: true,
              workPerformed: true,
              materials: true,
              extraWork: true
            }
          }
        },
        orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
        take: 200
      });

      const history = rows
        .filter((row) => normalizeAddress(row.address) === addressKey)
        .slice(0, limit)
        .map((row) => ({
          intervention: {
            id: row.id,
            title: row.title,
            startAt: row.startAt,
            endAt: row.endAt,
            status: row.status,
            priority: row.priority,
            address: row.address
          },
          technicians: [row.technician?.name, row.secondaryTechnician?.name].filter(
            (name): name is string => Boolean(name)
          ),
          workReport: row.workReport
            ? {
                isSigned: Boolean(row.workReport.signedAt),
                signedAt: row.workReport.signedAt,
                workPerformed: truncateText(row.workReport.workPerformed),
                materials: truncateText(row.workReport.materials),
                extraWork: truncateText(row.workReport.extraWork)
              }
            : null
        }));

      return res.json(history);
    } catch (error) {
      logApiError(req, error);
      return res.status(500).json({ ok: false, error: "Errore recupero storico indirizzo" });
    }
  });

  // GET /api/interventions/:id
  app.get('/api/interventions/:id', allowTech, async (req, res) => {
    try {
      const intervention = await prisma.intervention.findUnique({
        where: { id: Number(req.params.id) },
        include: {
          technician: true,
          secondaryTechnician: true,
          media: true,
          customer: true,
          workReport: true
        }
      });
      if (!intervention) return res.status(404).json({ error: "Not found" });
      if (!userCanAccessIntervention(req.user, intervention)) {
        return res.status(403).json({ ok: false, error: "Non autorizzato" });
      }
      res.json(intervention);
    } catch (error) {
      logApiError(req, error);
      res.status(500).json({ ok: false, error: 'Errore durante il recupero del dettaglio intervento' });
    }
  });

  // GET /api/interventions/:id/details (dettaglio esteso con allegati)
  app.get('/api/interventions/:id/details', allowTech, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const intervention = await prisma.intervention.findUnique({
        where: { id },
        select: {
          id: true,
          version: true,
          title: true,
          description: true,
          address: true,
          status: true,
          priority: true,
          startAt: true,
          endAt: true,
          technicianId: true,
          secondaryTechnicianId: true,
          customerId: true,
          customerNameSnapshot: true,
          customerEmailSnapshot: true,
          customerPhoneSnapshot: true,
          customerAddressSnapshot: true,
          createdAt: true,
          updatedAt: true,
          customer: {
            select: {
              id: true,
              name: true,
              companyName: true,
              email: true,
              phone1: true,
              phone2: true,
              customerType: true,
              preferredTimeSlot: true,
              taxCode: true,
              vatNumber: true,
              addressLine: true,
              physicalAddress: true,
              intercomInfo: true,
              intercomLabel: true,
              city: true,
              notes: true,
              isActive: true,
              createdAt: true,
              updatedAt: true
            }
          },
          attachments: {
            select: {
              id: true,
              kind: true,
              mimeType: true,
              originalName: true,
              size: true,
              createdAt: true
            },
            orderBy: { createdAt: 'desc' }
          },
          workReport: {
            select: {
              id: true,
              reportNumber: true,
              interventionId: true,
              version: true,
              actualStartAt: true,
              actualEndAt: true,
              actualMinutes: true,
              pausedMinutes: true,
              pauseStartAt: true,
              workPerformed: true,
              extraWork: true,
              materials: true,
              customerName: true,
              customerEmail: true,
              signatureToken: true,
              signatureRequestedAt: true,
              customerSignatureDataUrl: true,
              signedAt: true,
              emailedAt: true,
              createdAt: true,
              updatedAt: true,
              attachments: {
                select: {
                  id: true,
                  kind: true,
                  mimeType: true,
                  originalName: true,
                  size: true,
                  createdAt: true
                },
                orderBy: { createdAt: 'desc' }
              }
            }
          }
        }
      });

      if (!intervention) {
        return res.status(404).json({ error: "Intervento non trovato" });
      }

      if (!userCanAccessIntervention(req.user, intervention)) {
        return res.status(403).json({ ok: false, error: "Non autorizzato" });
      }

      res.json({
        ...intervention,
        attachments: intervention.attachments.map(toAttachmentDto),
        workReport: intervention.workReport
          ? {
              ...intervention.workReport,
              attachments: intervention.workReport.attachments.map(toAttachmentDto)
            }
          : null
      });
    } catch (error) {
      logApiError(req, error);
      res.status(500).json({ ok: false, error: "Errore durante il recupero dettaglio intervento" });
    }
  });

  // POST /api/interventions
  app.post('/api/interventions', allowDispatcher, async (req, res) => {
    try {
      const data = interventionSchema.parse(req.body);
      const { media, ...interventionData } = data;
      if (interventionData.status === InterventionStatus.COMPLETED) {
        return res.status(400).json({ error: INTERVENTION_COMPLETION_BLOCKED_ERROR_MESSAGE });
      }

      const intervention = await prisma.intervention.create({
        data: {
          ...interventionData,
          jobId: interventionData.jobId ?? null,
          startAt: interventionData.startAt ? new Date(interventionData.startAt) : null,
          endAt: interventionData.endAt ? new Date(interventionData.endAt) : null,
          media: media ? {
            create: media
          } : undefined
        },
        include: { technician: true, secondaryTechnician: true, customer: true, workReport: true }
      });

      if (intervention.technicianId) {
        notifyTechnician(intervention.technicianId, "Nuovo Intervento Assegnato", `Ti è stato assegnato: ${intervention.title}`, `/technician`);
      }
      if (intervention.secondaryTechnicianId) {
        notifyTechnician(intervention.secondaryTechnicianId, "Nuovo Intervento Assegnato", `Sei stato assegnato come supporto: ${intervention.title}`, `/technician`);
      }

      res.status(201).json(intervention);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ errors: (error as any).errors || error.issues });
      }
      console.error(error);
      res.status(500).json({ ok: false, error: 'Errore durante la creazione dell\'intervento' });
    }
  });

  // POST /api/interventions/:id/duplicate
  app.post('/api/interventions/:id/duplicate', allowDispatcher, async (req, res) => {
    const sourceId = Number(req.params.id);
    const action = "intervention.duplicate";
    const baseEntity = { interventionId: sourceId };
    try {
      const parsedBody = duplicateInterventionSchema.parse(req.body || {});
      const hasTechOverride = Object.prototype.hasOwnProperty.call(parsedBody, 'technicianId');
      const hasSecondaryTechOverride = Object.prototype.hasOwnProperty.call(parsedBody, 'secondaryTechnicianId');

      const source = await prisma.intervention.findUnique({
        where: { id: sourceId }
      });

      if (!source) {
        auditLog(req, action, baseEntity, "not_found", { status: 404 });
        return res.status(404).json({ error: "Intervento non trovato" });
      }

      const technicianId = hasTechOverride ? (parsedBody.technicianId ?? null) : (source.technicianId ?? null);
      const secondaryTechnicianId = hasSecondaryTechOverride
        ? (parsedBody.secondaryTechnicianId ?? null)
        : (source.secondaryTechnicianId ?? null);

      const duplicated = await prisma.intervention.create({
        data: {
          title: source.title,
          description: source.description,
          address: source.address,
          status: InterventionStatus.SCHEDULED,
          priority: source.priority,
          startAt: source.startAt,
          endAt: source.endAt,
          technicianId,
          secondaryTechnicianId,
          customerId: source.customerId,
          customerNameSnapshot: source.customerNameSnapshot,
          customerEmailSnapshot: source.customerEmailSnapshot,
          customerPhoneSnapshot: source.customerPhoneSnapshot,
          customerAddressSnapshot: source.customerAddressSnapshot
        },
        select: {
          id: true,
          version: true,
          title: true,
          description: true,
          address: true,
          status: true,
          priority: true,
          startAt: true,
          endAt: true,
          technicianId: true,
          secondaryTechnicianId: true,
          customerId: true,
          customerNameSnapshot: true,
          customerEmailSnapshot: true,
          customerPhoneSnapshot: true,
          customerAddressSnapshot: true,
          createdAt: true,
          updatedAt: true,
          technician: { select: { id: true, name: true, color: true } },
          secondaryTechnician: { select: { id: true, name: true, color: true } },
          customer: {
            select: {
              id: true,
              name: true,
              companyName: true,
              email: true,
              phone1: true,
              phone2: true,
              customerType: true,
              preferredTimeSlot: true,
              addressLine: true,
              physicalAddress: true,
              intercomInfo: true,
              intercomLabel: true,
              city: true,
              notes: true
            }
          },
          workReport: { select: { id: true, reportNumber: true, emailedAt: true, signedAt: true, signatureRequestedAt: true } }
        }
      });

      if (duplicated.technicianId) {
        notifyTechnician(duplicated.technicianId, "Nuovo Intervento Assegnato", `Ti è stato assegnato: ${duplicated.title}`, `/technician`);
      }
      if (duplicated.secondaryTechnicianId) {
        notifyTechnician(duplicated.secondaryTechnicianId, "Nuovo Intervento Assegnato", `Sei stato assegnato come supporto: ${duplicated.title}`, `/technician`);
      }

      auditLog(
        req,
        action,
        { interventionId: sourceId },
        "success",
        { status: 201, duplicatedInterventionId: duplicated.id }
      );
      res.status(201).json(duplicated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        auditLog(req, action, baseEntity, "error", { status: 400 });
        return res.status(400).json({ errors: (error as any).errors || error.issues });
      }
      auditLog(req, action, baseEntity, "error", { status: 500 });
      logApiError(req, error);
      res.status(500).json({ ok: false, error: "Errore duplicazione intervento" });
    }
  });

  // POST /api/interventions/:id/attachments (admin/dispatcher)
  app.post('/api/interventions/:id/attachments', allowDispatcher, attachmentUploadLimiter, handleMulterArray('files'), async (req, res) => {
    const uploadedFiles = (req.files as Express.Multer.File[] | undefined) ?? [];
    const interventionId = Number(req.params.id);
    const action = "attachments.upload.intervention";
    const totalBytes = uploadedFiles.reduce((acc, file) => acc + (file.size || 0), 0);
    const baseEntity = { interventionId: Number.isFinite(interventionId) ? interventionId : null };
    try {
      if (!Number.isFinite(interventionId)) {
        for (const file of uploadedFiles) await safeUnlinkFile(file.path);
        auditLog(req, action, baseEntity, "error", { status: 400, count: uploadedFiles.length });
        return res.status(400).json({ error: "ID intervento non valido" });
      }

      const intervention = await prisma.intervention.findUnique({
        where: { id: interventionId },
        select: { id: true }
      });
      if (!intervention) {
        for (const file of uploadedFiles) await safeUnlinkFile(file.path);
        auditLog(req, action, baseEntity, "not_found", { status: 404, count: uploadedFiles.length });
        return res.status(404).json({ error: "Intervento non trovato" });
      }

      if (uploadedFiles.length === 0) {
        auditLog(req, action, baseEntity, "error", { status: 400, count: 0 });
        return res.status(400).json({ error: "Nessun file ricevuto" });
      }

      const created = await prisma.$transaction(async (tx) => {
        const records = [];
        for (const file of uploadedFiles) {
          const row = await tx.interventionAttachment.create({
            data: {
              interventionId,
              kind: attachmentKindFromMime(file.mimetype || ""),
              mimeType: file.mimetype || "application/octet-stream",
              originalName: sanitizeOriginalFilename(file.originalname || "file"),
              storedName: path.basename(file.filename),
              size: file.size,
              createdByUserId: req.user?.id ?? null
            },
            select: {
              id: true,
              kind: true,
              mimeType: true,
              originalName: true,
              size: true,
              createdAt: true
            }
          });
          records.push(row);
        }
        return records;
      });

      auditLog(req, action, baseEntity, "success", {
        status: 201,
        count: created.length,
        totalBytes
      });
      res.status(201).json({ attachments: created.map(toAttachmentDto) });
    } catch (error) {
      for (const file of uploadedFiles) await safeUnlinkFile(file.path);
      auditLog(req, action, baseEntity, "error", { status: 500, count: uploadedFiles.length });
      logApiError(req, error);
      res.status(500).json({ ok: false, error: "Errore upload allegati intervento" });
    }
  });

  // PATCH /api/interventions/:id
  app.patch("/api/interventions/:id", allowTech, async (req, res) => {
    const id = Number(req.params.id);
    const action = "intervention.update";
    const baseEntity = { interventionId: id };
    try {
      const { version, ...updateData } = UpdateInterventionSchema.parse(req.body);

      const current = await prisma.intervention.findUnique({ where: { id } });
      if (!current) {
        auditLog(req, action, baseEntity, "not_found", { status: 404 });
        return res.status(404).json({ error: "Intervento non trovato" });
      }
      if (!userCanAccessIntervention(req.user, current)) {
        auditLog(req, action, baseEntity, "forbidden", { status: 403 });
        return res.status(403).json({ ok: false, error: "Non autorizzato" });
      }

      // Optimistic Locking Check 
      if (version === undefined) {
        auditLog(req, action, baseEntity, "error", { status: 400 });
        return res.status(400).json({ error: "Manca la versione (version) nel payload per il controllo di concorrenza." });
      }
      if (version !== current.version) {
        auditLog(req, action, baseEntity, "conflict", { status: 409 });
        return res.status(409).json({ error: "Intervento modificato da altro utente" });
      }

      if (updateData.status && updateData.status !== current.status) {
        const currentStatus = current.status as InterventionStatus;
        const nextStatus = updateData.status as InterventionStatus;
        const allowedNext = allowedStatusTransitions[currentStatus] || [currentStatus];
        if (!allowedNext.includes(nextStatus)) {
          auditLog(req, action, baseEntity, "error", { status: 400 });
          return res.status(400).json({ error: "Transizione stato non valida" });
        }
      }
      if (updateData.status === InterventionStatus.COMPLETED && current.status !== InterventionStatus.COMPLETED) {
        const completion = await getInterventionCompletionEligibility({
          tx: prisma,
          interventionId: id
        });
        if (!completion.eligible) {
          auditLog(req, action, baseEntity, "error", { status: 400 });
          return res.status(400).json({ error: INTERVENTION_COMPLETION_BLOCKED_ERROR_MESSAGE });
        }
      }

      // Logical Lock for IN_PROGRESS
      if (current.status === 'IN_PROGRESS') {
        const tryingToChangeTech = (updateData.technicianId !== undefined && updateData.technicianId !== current.technicianId) ||
          (updateData.secondaryTechnicianId !== undefined && updateData.secondaryTechnicianId !== current.secondaryTechnicianId);

        let tryingToChangeDate = false;
        if (updateData.startAt !== undefined) {
          const incomingStart = updateData.startAt ? new Date(updateData.startAt).getTime() : null;
          const currentStart = current.startAt ? current.startAt.getTime() : null;
          if (incomingStart !== currentStart) tryingToChangeDate = true;
        }
        if (updateData.endAt !== undefined) {
          const incomingEnd = updateData.endAt ? new Date(updateData.endAt).getTime() : null;
          const currentEnd = current.endAt ? current.endAt.getTime() : null;
          if (incomingEnd !== currentEnd) tryingToChangeDate = true;
        }

        if (tryingToChangeTech || tryingToChangeDate) {
          auditLog(req, action, baseEntity, "forbidden", { status: 403 });
          return res.status(403).json({ error: "Operazione non consentita", message: "Non puoi modificare tecnico o data per un intervento in esecuzione." });
        }
      }

      const newTechId = updateData.technicianId !== undefined ? updateData.technicianId : current.technicianId;
      const newSecTechId = updateData.secondaryTechnicianId !== undefined ? updateData.secondaryTechnicianId : current.secondaryTechnicianId;
      const newStartAt = updateData.startAt !== undefined ? updateData.startAt : current.startAt;
      const newEndAt = updateData.endAt !== undefined ? updateData.endAt : current.endAt;

      const isChangingSchedule = updateData.technicianId !== undefined || updateData.secondaryTechnicianId !== undefined || updateData.startAt !== undefined || updateData.endAt !== undefined;

      if (isChangingSchedule && (newTechId || newSecTechId) && newStartAt && newEndAt) {
        // Auto update status if moving from backlog to calendar
        if (updateData.status === 'SCHEDULED' || !updateData.status) {
          if (current?.status === 'SCHEDULED') {
            updateData.status = 'SCHEDULED';
          }
        }
      }

      const safeUpdateData: any = {
        title: updateData.title,
        description: updateData.description,
        address: updateData.address,
        status: updateData.status,
        priority: updateData.priority,
        technicianId: updateData.technicianId,
        secondaryTechnicianId: updateData.secondaryTechnicianId,
        jobId: updateData.jobId,
        customerId: updateData.customerId,
      };
      Object.keys(safeUpdateData).forEach(key => safeUpdateData[key] === undefined && delete safeUpdateData[key]);

      let updatedIntervention = await prisma.intervention.update({
        where: { id: Number(req.params.id) },
        data: {
          ...safeUpdateData,
          version: { increment: 1 },
          startAt: updateData.startAt !== undefined ? (updateData.startAt ? new Date(updateData.startAt) : null) : undefined,
          endAt: updateData.endAt !== undefined ? (updateData.endAt ? new Date(updateData.endAt) : null) : undefined,
          ...(req.body.media && Array.isArray(req.body.media) ? {
            media: {
              create: req.body.media.map((m: any) => ({
                url: m.url,
                type: m.type
              }))
            }
          } : {})
        },
        include: { technician: true, secondaryTechnician: true, customer: true, workReport: true }
      });

      if (updateData.status === InterventionStatus.COMPLETED) {
        const finalizedReport = await prisma.$transaction(async (tx) => {
          const currentReport = await getOrCreateWorkReport(tx, id);
          const timingPatch = getAutomaticTimingPatch({
            report: currentReport,
            interventionStartAt: updatedIntervention.startAt,
            now: new Date(),
            finalize: true
          });

          if (!timingPatch) {
            return currentReport;
          }

          return tx.workReport.update({
            where: { interventionId: id },
            data: {
              ...timingPatch,
              version: { increment: 1 }
            }
          });
        });

        updatedIntervention = {
          ...updatedIntervention,
          workReport: finalizedReport
        };
      }

      // Notifications for assignment changes
      if (updateData.technicianId !== undefined && updateData.technicianId !== current.technicianId) {
        if (updateData.technicianId) {
          notifyTechnician(updateData.technicianId, "Intervento Assegnato", `Ti è stato assegnato: ${updatedIntervention.title}`, `/technician`);
        }
        if (current.technicianId) {
          notifyTechnician(current.technicianId, "Intervento Rimosso", `L'intervento ${current.title} è stato riassegnato.`, `/technician`);
        }
      }

      if (updateData.secondaryTechnicianId !== undefined && updateData.secondaryTechnicianId !== current.secondaryTechnicianId) {
        if (updateData.secondaryTechnicianId) {
          notifyTechnician(updateData.secondaryTechnicianId, "Intervento Assegnato", `Sei stato assegnato come supporto: ${updatedIntervention.title}`, `/technician`);
        }
        if (current.secondaryTechnicianId) {
          notifyTechnician(current.secondaryTechnicianId, "Intervento Rimosso", `Non sei più assegnato a: ${current.title}`, `/technician`);
        }
      }

      auditLog(req, action, baseEntity, "success", { status: 200 });
      res.json(updatedIntervention);
    } catch (error) {
      if (error instanceof z.ZodError) {
        auditLog(req, action, baseEntity, "error", { status: 400 });
        return res.status(400).json({ error: (error as any).errors });
      }
      auditLog(req, action, baseEntity, "error", { status: 500 });
      console.error(error);
      res.status(500).json({ ok: false, error: "Failed to update intervention" });
    }
  });

  // DELETE /api/interventions/:id
  app.delete("/api/interventions/:id", allowDispatcher, async (req, res) => {
    try {
      const current = await prisma.intervention.findUnique({ where: { id: Number(req.params.id) } });
      await prisma.intervention.delete({
        where: { id: Number(req.params.id) }
      });

      if (current?.technicianId) {
        notifyTechnician(current.technicianId, "Intervento Annullato", `L'intervento ${current.title} è stato annullato dal calendario.`, `/technician`);
      }

      if (current?.secondaryTechnicianId) {
        notifyTechnician(current.secondaryTechnicianId, "Intervento Annullato", `L'intervento ${current.title} è stato annullato dal calendario.`, `/technician`);
      }

      res.status(204).send();
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: "Failed to delete intervention" });
    }
  });

  // POST /api/push/subscribe (NEW)
  app.post("/api/push/subscribe", allowTech, async (req, res) => {
    try {
      const { endpoint, keys, technicianId, role } = req.body;
      if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
        return res.status(400).json({ error: "Invalid subscription" });
      }

      // Upsert subscriptio
      const sub = await prisma.pushSubscription.upsert({
        where: { endpoint },
        update: {
          technicianId: technicianId ? Number(technicianId) : null,
          p256dh: keys.p256dh,
          auth: keys.auth,
          role: role || "TECHNICIAN"
        },
        create: {
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          technicianId: technicianId ? Number(technicianId) : null,
          role: role || "TECHNICIAN"
        }
      });
      res.json(sub);
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: "Push subscribe fail" });
    }
  });

  // --- WORK REPORT API ---

  // GET /api/interventions/:id/work-report (Ottieni o crea bozza)
  app.get("/api/interventions/:id/work-report", allowTech, async (req, res) => {
    try {
      const interventionId = Number(req.params.id);
      const intervention = await prisma.intervention.findUnique({
        where: { id: interventionId },
        select: { id: true, technicianId: true, secondaryTechnicianId: true }
      });
      if (!intervention) {
        return res.status(404).json({ error: "Intervento non trovato" });
      }
      if (!userCanAccessIntervention(req.user, intervention)) {
        return res.status(403).json({ ok: false, error: "Non autorizzato" });
      }
      let report = await prisma.workReport.findUnique({ where: { interventionId } });

      if (!report) {
        let retries = 2;
        while (retries >= 0) {
          try {
            report = await prisma.$transaction(async (tx) => {
              const max = await tx.workReport.aggregate({ _max: { reportNumber: true } });
              const next = (max._max.reportNumber ?? -1) + 1;

              return await tx.workReport.create({
                data: {
                  interventionId,
                  reportNumber: next
                }
              });
            });
            break; // success
          } catch (err: any) {
            if (err.code === 'P2002' && retries > 0) {
              retries--;
              continue;
            }
            throw err; // if out of retries or not P2002
          }
        }
      }
      res.json(report);
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: "Failed to create work report due to database contention. Riprova tra qualche istante." });
    }
  });

  // PATCH /api/interventions/:id/work-report (Aggiorna testi e cliente)
  app.patch("/api/interventions/:id/work-report", allowTech, async (req, res) => {
    try {
      const interventionId = Number(req.params.id);
      const intervention = await prisma.intervention.findUnique({
        where: { id: interventionId },
        select: { id: true, technicianId: true, secondaryTechnicianId: true, startAt: true }
      });
      if (!intervention) {
        return res.status(404).json({ error: "Intervento non trovato" });
      }
      if (!userCanAccessIntervention(req.user, intervention)) {
        return res.status(403).json({ ok: false, error: "Non autorizzato" });
      }
      const body = req.body || {};
      const { version, ...rawPatch } = body;
      const parsed = workReportUpdateSchema.parse(rawPatch);
      const { actualMinutes: manualActualMinutesRaw, ...parsedContent } = parsed;
      const data: any = {};
      Object.entries(parsedContent).forEach(([key, value]) => {
        if (value !== undefined) data[key] = value;
      });
      const manualActualMinutes = normalizeManualActualMinutes(manualActualMinutesRaw);
      if (manualActualMinutes !== undefined) {
        data.actualMinutes = manualActualMinutes;
      }

      const report = await prisma.$transaction(async (tx) => {
        const currentReport = await getOrCreateWorkReport(tx, interventionId);
        const patchData: Record<string, unknown> = { ...data };
        if (!currentReport.actualStartAt) {
          const autoStartAt = getAutomaticWorkReportStartAt(intervention.startAt, new Date());
          patchData.actualStartAt = autoStartAt;
          if (!currentReport.clientStartAt) {
            patchData.clientStartAt = autoStartAt;
          }
        }

        const updatedReport = await updateWorkReportContentWithOptimisticLock({
          tx,
          interventionId,
          providedVersion: version,
          data: patchData
        });

        const completion = await getInterventionCompletionEligibility({
          tx,
          interventionId
        });
        if (completion.eligible) {
          await tx.intervention.updateMany({
            where: {
              id: interventionId,
              status: {
                notIn: [
                  InterventionStatus.COMPLETED,
                  InterventionStatus.FAILED,
                  InterventionStatus.CANCELLED,
                  InterventionStatus.NO_SHOW
                ]
              }
            },
            data: {
              status: InterventionStatus.COMPLETED,
              version: { increment: 1 }
            }
          });
        }

        return updatedReport;
      });
      res.json(report);
    } catch (error: any) {
      if (error?.status && error?.message) {
        return res.status(error.status).json({ error: error.message });
      }
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Dati non validi", details: error.issues });
      }
      console.error(error);
      res.status(500).json({ ok: false, error: "Failed to update work report" });
    }
  });

  // POST /api/work-reports/:id/attachments
  app.post("/api/work-reports/:id/attachments", allowTech, attachmentUploadLimiter, handleMulterArray('files'), async (req, res) => {
    const uploadedFiles = (req.files as Express.Multer.File[] | undefined) ?? [];
    const workReportId = String(req.params.id || "");
    const action = "attachments.upload.workReport";
    const totalBytes = uploadedFiles.reduce((acc, file) => acc + (file.size || 0), 0);
    let auditedEntity: AuditEntity = { workReportId: workReportId || null };
    try {
      if (!workReportId) {
        for (const file of uploadedFiles) await safeUnlinkFile(file.path);
        auditLog(req, action, auditedEntity, "error", { status: 400, count: uploadedFiles.length });
        return res.status(400).json({ error: "ID bolla non valido" });
      }

      const workReport = await prisma.workReport.findUnique({
        where: { id: workReportId },
        select: {
          id: true,
          intervention: {
            select: {
              id: true,
              technicianId: true,
              secondaryTechnicianId: true
            }
          }
        }
      });

      if (!workReport) {
        for (const file of uploadedFiles) await safeUnlinkFile(file.path);
        auditLog(req, action, auditedEntity, "not_found", { status: 404, count: uploadedFiles.length });
        return res.status(404).json({ error: "Bolla non trovata" });
      }
      auditedEntity = { workReportId: workReport.id, interventionId: workReport.intervention.id };

      if (!userCanAccessIntervention(req.user, workReport.intervention)) {
        for (const file of uploadedFiles) await safeUnlinkFile(file.path);
        auditLog(req, action, auditedEntity, "forbidden", { status: 403, count: uploadedFiles.length });
        return res.status(403).json({ ok: false, error: "Non autorizzato" });
      }

      if (uploadedFiles.length === 0) {
        auditLog(req, action, auditedEntity, "error", { status: 400, count: 0 });
        return res.status(400).json({ error: "Nessun file ricevuto" });
      }

      const created = await prisma.$transaction(async (tx) => {
        const rows = [];
        for (const file of uploadedFiles) {
          const row = await tx.workReportAttachment.create({
            data: {
              workReportId: workReport.id,
              kind: attachmentKindFromMime(file.mimetype || ""),
              mimeType: file.mimetype || "application/octet-stream",
              originalName: sanitizeOriginalFilename(file.originalname || "file"),
              storedName: path.basename(file.filename),
              size: file.size
            },
            select: {
              id: true,
              kind: true,
              mimeType: true,
              originalName: true,
              size: true,
              createdAt: true
            }
          });
          rows.push(row);
        }

        const completion = await getInterventionCompletionEligibility({
          tx,
          interventionId: workReport.intervention.id
        });
        if (completion.eligible) {
          await tx.intervention.updateMany({
            where: {
              id: workReport.intervention.id,
              status: {
                notIn: [
                  InterventionStatus.COMPLETED,
                  InterventionStatus.FAILED,
                  InterventionStatus.CANCELLED,
                  InterventionStatus.NO_SHOW
                ]
              }
            },
            data: {
              status: InterventionStatus.COMPLETED,
              version: { increment: 1 }
            }
          });
        }

        return rows;
      });

      auditLog(req, action, auditedEntity, "success", {
        status: 201,
        count: created.length,
        totalBytes
      });
      res.status(201).json({ attachments: created.map(toAttachmentDto) });
    } catch (error) {
      for (const file of uploadedFiles) await safeUnlinkFile(file.path);
      auditLog(req, action, auditedEntity, "error", { status: 500, count: uploadedFiles.length });
      logApiError(req, error);
      res.status(500).json({ ok: false, error: "Errore upload allegati bolla" });
    }
  });

  // POST /api/interventions/:id/work-report/start
  app.post("/api/interventions/:id/work-report/start", allowTech, async (req, res) => {
    const interventionId = Number(req.params.id);
    const action = "workReport.start";
    const baseEntity = { interventionId: Number.isFinite(interventionId) ? interventionId : null };
    try {
      const now = new Date();
      let outcome: AuditOutcome = "success";

      const report = await prisma.$transaction(async (tx) => {
        const intervention = await tx.intervention.findUnique({
          where: { id: interventionId },
          select: { id: true, status: true, technicianId: true, secondaryTechnicianId: true }
        });
        if (!intervention) {
          throw { status: 404, message: "Intervento non trovato" };
        }
        if (!userCanAccessIntervention(req.user, intervention)) {
          throw { status: 403, message: "Non autorizzato" };
        }

        const currentReport = await getOrCreateWorkReport(tx, interventionId);

        if (currentReport.actualStartAt) {
          outcome = "noop";
          return currentReport;
        }

        if (intervention.status === InterventionStatus.COMPLETED) {
          throw { status: 400, message: "Intervento già completato" };
        }

        const result = await tx.workReport.updateMany({
          where: {
            interventionId,
            version: currentReport.version,
            actualStartAt: null,
            actualEndAt: null
          },
          data: {
            actualStartAt: now,
            clientStartAt: now,
            pauseStartAt: null,
            pausedMinutes: Math.max(0, Math.floor(currentReport.pausedMinutes || 0)),
            actualMinutes: 0,
            version: { increment: 1 }
          }
        });

        if (result.count !== 1) {
          const latest = await tx.workReport.findUnique({ where: { interventionId } });
          if (!latest) throw { status: 404, message: "Work report not found" };
          if (latest.actualStartAt) {
            outcome = "noop";
            return latest;
          }
          throw { status: 409, message: WORK_REPORT_TIMING_CONFLICT_MESSAGE };
        }

        const updated = await tx.workReport.findUnique({ where: { interventionId } });
        if (!updated) throw { status: 404, message: "Work report not found" };

        await tx.intervention.update({
          where: { id: interventionId },
          data: {
            status: InterventionStatus.IN_PROGRESS,
            version: { increment: 1 }
          }
        });

        return updated;
      });

      auditLog(req, action, { ...baseEntity, workReportId: String((report as any)?.id || "") }, outcome, { status: 200 });
      res.json(report);
    } catch (error: any) {
      if (error?.status && error?.message) {
        auditLog(req, action, baseEntity, auditOutcomeFromStatus(Number(error.status)), { status: Number(error.status) });
        return res.status(error.status).json({ error: error.message });
      }
      auditLog(req, action, baseEntity, "error", { status: 500 });
      console.error(error);
      res.status(500).json({ ok: false, error: "Errore avvio lavoro" });
    }
  });

  // POST /api/interventions/:id/work-report/pause-start
  app.post("/api/interventions/:id/work-report/pause-start", allowTech, async (req, res) => {
    const interventionId = Number(req.params.id);
    const action = "workReport.pauseStart";
    const baseEntity = { interventionId: Number.isFinite(interventionId) ? interventionId : null };
    try {
      const now = new Date();
      let outcome: AuditOutcome = "success";
      const report = await prisma.$transaction(async (tx) => {
        const intervention = await tx.intervention.findUnique({
          where: { id: interventionId },
          select: { id: true, technicianId: true, secondaryTechnicianId: true }
        });
        if (!intervention) throw { status: 404, message: "Intervento non trovato" };
        if (!userCanAccessIntervention(req.user, intervention)) throw { status: 403, message: "Non autorizzato" };
        const before = await getOrCreateWorkReport(tx, interventionId);
        const after = await pauseStartWorkReportInTransaction({
          tx,
          interventionId,
          now
        });
        if ((after as any)?.version === before.version) {
          outcome = "noop";
        }
        return after;
      });
      auditLog(req, action, { ...baseEntity, workReportId: String((report as any)?.id || "") }, outcome, { status: 200 });
      res.json(report);
    } catch (error: any) {
      if (error?.status && error?.message) {
        auditLog(req, action, baseEntity, auditOutcomeFromStatus(Number(error.status)), { status: Number(error.status) });
        return res.status(error.status).json({ error: error.message });
      }
      auditLog(req, action, baseEntity, "error", { status: 500 });
      console.error(error);
      res.status(500).json({ ok: false, error: "Failed to start pause" });
    }
  });

  // POST /api/interventions/:id/work-report/pause-stop
  app.post("/api/interventions/:id/work-report/pause-stop", allowTech, async (req, res) => {
    const interventionId = Number(req.params.id);
    const action = "workReport.pauseStop";
    const baseEntity = { interventionId: Number.isFinite(interventionId) ? interventionId : null };
    try {
      const now = new Date();
      let outcome: AuditOutcome = "success";
      const report = await prisma.$transaction(async (tx) => {
        const intervention = await tx.intervention.findUnique({
          where: { id: interventionId },
          select: { id: true, technicianId: true, secondaryTechnicianId: true }
        });
        if (!intervention) throw { status: 404, message: "Intervento non trovato" };
        if (!userCanAccessIntervention(req.user, intervention)) throw { status: 403, message: "Non autorizzato" };
        const before = await getOrCreateWorkReport(tx, interventionId);
        const after = await pauseStopWorkReportInTransaction({
          tx,
          interventionId,
          now
        });
        if ((after as any)?.version === before.version) {
          outcome = "noop";
        }
        return after;
      });
      auditLog(req, action, { ...baseEntity, workReportId: String((report as any)?.id || "") }, outcome, { status: 200 });
      res.json(report);
    } catch (error: any) {
      if (error?.status && error?.message) {
        auditLog(req, action, baseEntity, auditOutcomeFromStatus(Number(error.status)), { status: Number(error.status) });
        return res.status(error.status).json({ error: error.message });
      }
      auditLog(req, action, baseEntity, "error", { status: 500 });
      console.error(error);
      res.status(500).json({ ok: false, error: "Failed to stop pause" });
    }
  });

  // POST /api/interventions/:id/work-report/stop
  app.post("/api/interventions/:id/work-report/stop", allowTech, async (req, res) => {
    const interventionId = Number(req.params.id);
    const action = "workReport.stop";
    const baseEntity = { interventionId: Number.isFinite(interventionId) ? interventionId : null };
    try {
      const { notes } = req.body || {};
      const now = new Date();
      let outcome: AuditOutcome = "success";

      const report = await prisma.$transaction(async (tx) => {
        const intervention = await tx.intervention.findUnique({
          where: { id: interventionId },
          select: { id: true, technicianId: true, secondaryTechnicianId: true }
        });
        if (!intervention) throw { status: 404, message: "Intervento non trovato" };
        if (!userCanAccessIntervention(req.user, intervention)) throw { status: 403, message: "Non autorizzato" };
        const before = await getOrCreateWorkReport(tx, interventionId);
        const after = await stopWorkReportInTransaction({
          tx,
          interventionId,
          now,
          notes
        });
        if ((after as any)?.version === before.version) {
          outcome = "noop";
        }
        return after;
      });

      auditLog(req, action, { ...baseEntity, workReportId: String((report as any)?.id || "") }, outcome, { status: 200 });
      res.json(report);
    } catch (error: any) {
      if (error?.status && error?.message) {
        auditLog(req, action, baseEntity, auditOutcomeFromStatus(Number(error.status)), { status: Number(error.status) });
        return res.status(error.status).json({ error: error.message });
      }
      auditLog(req, action, baseEntity, "error", { status: 500 });
      console.error(error);
      res.status(500).json({ ok: false, error: "Errore chiusura lavoro" });
    }
  });

  // POST /api/interventions/:id/work-report/generate-sign-link
  app.post("/api/interventions/:id/work-report/generate-sign-link", allowTech, async (req, res) => {
    const interventionId = Number(req.params.id);
    const action = "workReport.sign.generateLink";
    const baseEntity = { interventionId: Number.isFinite(interventionId) ? interventionId : null };
    try {
      const intervention = await prisma.intervention.findUnique({
        where: { id: interventionId },
        select: { id: true, technicianId: true, secondaryTechnicianId: true }
      });
      if (!intervention) {
        return res.status(404).json({ error: "Intervento non trovato" });
      }
      if (!userCanAccessIntervention(req.user, intervention)) {
        return res.status(403).json({ ok: false, error: "Non autorizzato" });
      }

      const token = uuidv4();

      let report = await prisma.workReport.findUnique({ where: { interventionId } });
      if (report) {
        report = await prisma.workReport.update({
          where: { interventionId },
          data: { signatureToken: token, signatureRequestedAt: new Date() }
        });
      } else {
        report = await prisma.$transaction(async (tx) => {
          const max = await tx.workReport.aggregate({ _max: { reportNumber: true } });
          const next = (max._max.reportNumber ?? -1) + 1;
          return await tx.workReport.create({
            data: {
              interventionId,
              reportNumber: next,
              signatureToken: token,
              signatureRequestedAt: new Date()
            }
          });
        });
      }

      const url = `/sign/${token}`; // Relative URL for frontend router
      auditLog(req, action, { ...baseEntity, workReportId: String(report.id) }, "success", { status: 200 });
      res.json({ url, token });
    } catch (error) {
      auditLog(req, action, baseEntity, "error", { status: 500 });
      console.error(error);
      res.status(500).json({ ok: false, error: "Failed to generate sign link" });
    }
  });

  // GET /api/public/sign/:token (Per la pagina pubblica)
  app.get("/api/public/sign/:token", publicSignGetLimiter, async (req, res) => {
    const action = "workReport.sign.public.get";
    try {
      const { token } = req.params;
      const report = await getPublicSignWorkReportByTokenOrThrow({
        tx: prisma,
        token,
        now: new Date(),
        ttlHours: SIGN_TOKEN_TTL_HOURS,
        includeIntervention: true
      });
      auditLog(
        req,
        action,
        { interventionId: Number((report as any)?.interventionId) || null, workReportId: String((report as any)?.id || "") || null },
        "success",
        { status: 200 }
      );
      res.json(report);
    } catch (error: any) {
      if (error?.status && error?.message) {
        auditLog(req, action, {}, auditOutcomeFromStatus(Number(error.status)), { status: Number(error.status) });
        return res.status(error.status).json({ error: error.message });
      }
      auditLog(req, action, {}, "error", { status: 500 });
      console.error(error);
      res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  // POST /api/public/sign/:token (Salvataggio firma)
  app.post("/api/public/sign/:token", publicSignPostLimiter, async (req, res) => {
    const action = "workReport.sign.public.submit";
    let auditedEntity: AuditEntity = {};
    try {
      const { token } = req.params;
      const { signatureDataUrl, customerName } = req.body;
      const preReport = await prisma.workReport.findUnique({
        where: { signatureToken: token },
        select: { id: true, interventionId: true }
      });
      if (preReport) {
        auditedEntity = { interventionId: preReport.interventionId, workReportId: preReport.id };
      }

      if (!signatureDataUrl || typeof signatureDataUrl !== 'string' || signatureDataUrl.length < 100) {
        auditLog(req, action, auditedEntity, "error", { status: 400 });
        return res.status(400).json({ error: "Firma non valida" });
      }

      if (signatureDataUrl.length > 1_500_000) {
        auditLog(req, action, auditedEntity, "error", { status: 413 });
        return res.status(413).json({ error: "Firma troppo grande, riprova con una firma più piccola." });
      }

      const isValidMime = /^data:image\/(png|jpeg);base64,/i.test(signatureDataUrl);
      if (!isValidMime) {
        auditLog(req, action, auditedEntity, "error", { status: 400 });
        return res.status(400).json({ error: "Formato firma non valido. Usa PNG o JPEG." });
      }

      let normalizedCustomerName: string | undefined;
      if (customerName !== undefined && customerName !== null) {
        if (typeof customerName !== "string") {
          auditLog(req, action, auditedEntity, "error", { status: 400 });
          return res.status(400).json({ error: "Nome cliente non valido" });
        }
        const trimmedCustomerName = customerName.trim();
        if (trimmedCustomerName.length > 200) {
          auditLog(req, action, auditedEntity, "error", { status: 400 });
          return res.status(400).json({ error: "Nome cliente non valido" });
        }
        normalizedCustomerName = trimmedCustomerName || undefined;
      }

      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await signWorkReportByTokenInTransaction({
          tx,
          token,
          now,
          signatureDataUrl,
          customerName: normalizedCustomerName,
          ttlHours: SIGN_TOKEN_TTL_HOURS
        });

        if (!preReport?.id) {
          return;
        }

        const signedReport = await tx.workReport.findUnique({
          where: { id: preReport.id },
          select: {
            id: true,
            interventionId: true,
            actualStartAt: true,
            actualEndAt: true,
            clientStartAt: true,
            clientEndAt: true,
            pauseStartAt: true,
            pausedMinutes: true,
            intervention: { select: { startAt: true } }
          }
        });
        if (!signedReport) {
          return;
        }

        const timingPatch = getAutomaticTimingPatch({
          report: signedReport,
          interventionStartAt: signedReport.intervention.startAt,
          now,
          finalize: true
        });
        if (!timingPatch) {
          return;
        }

        await tx.workReport.update({
          where: { id: signedReport.id },
          data: {
            ...timingPatch,
            version: { increment: 1 }
          }
        });
      });

      auditLog(req, action, auditedEntity, "success", { status: 200 });
      res.json({ success: true });
    } catch (error: any) {
      if (error?.status && error?.message) {
        auditLog(req, action, auditedEntity, auditOutcomeFromStatus(Number(error.status)), { status: Number(error.status) });
        return res.status(error.status).json({ error: error.message });
      }
      auditLog(req, action, auditedEntity, "error", { status: 500 });
      console.error(error);
      res.status(500).json({ ok: false, error: "Failed to save signature" });
    }
  });

  // POST /api/interventions/:id/work-report/send-email
  app.post("/api/interventions/:id/work-report/send-email", allowTech, async (req, res) => {
    try {
      if (!WORK_REPORT_EMAIL_ENABLED) {
        return res.status(501).json({ error: "Invio email disabilitato in questa fase" });
      }
      const interventionId = Number(req.params.id);
      const report = await prisma.workReport.findUnique({
        where: { interventionId },
        include: { intervention: { include: { technician: true } } }
      });

      if (!report) {
        return res.status(400).json({ error: "Email cliente mancante o bolla inesistente" });
      }
      if (!userCanAccessIntervention(req.user, report.intervention)) {
        return res.status(403).json({ ok: false, error: "Non autorizzato" });
      }
      if (!report.customerEmail) {
        return res.status(400).json({ error: "Email cliente mancante o bolla inesistente" });
      }

      // Genera PDF in memoria
      const doc = new jsPDF();
      doc.setFontSize(22);
      doc.text(`Bolla di Lavoro #${report.reportNumber}`, 20, 20);
      doc.setFontSize(12);
      doc.text(`Intervento #${report.interventionId} - ${report.intervention.title}`, 20, 30);
      doc.text(`Indirizzo: ${report.intervention.address}`, 20, 40);

      doc.text(`Inizio: ${report.actualStartAt ? report.actualStartAt.toLocaleString() : 'N/D'}`, 20, 50);
      doc.text(`Fine: ${report.actualEndAt ? report.actualEndAt.toLocaleString() : 'N/D'}`, 20, 60);
      doc.text(`Minuti totali: ${report.actualMinutes}`, 20, 70);

      doc.text("Lavori Svolti:", 20, 90);
      doc.text(report.workPerformed || "Nessun lavoro inserito", 20, 100, { maxWidth: 170 });

      doc.text("Materiali:", 20, 130);
      doc.text(report.materials || "Nessun materiale", 20, 140, { maxWidth: 170 });

      if (report.customerSignatureDataUrl) {
        doc.text(`Firmato da: ${report.customerName || 'Cliente'}`, 20, 180);
        // Aggiungi firma se valida (deve essere base64 PNG/JPEG)
        try {
          doc.addImage(report.customerSignatureDataUrl, 'PNG', 20, 190, 80, 40);
        } catch (e) {
          doc.text("(Errore rendering firma immagine)", 20, 190);
        }
      } else {
        doc.text("Stato: NON FIRMATO", 20, 180);
      }

      const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

      // Configura Nodemailer
      // - In produzione: usa SMTP aziendale via ENV (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS)
      // - In demo/senza credenziali: usa jsonTransport (non invia davvero, ma evita errori)
      const hasSmtp =
        !!process.env.SMTP_HOST &&
        !!process.env.SMTP_PORT &&
        !!process.env.SMTP_USER &&
        !!process.env.SMTP_PASS;

      const transporter = hasSmtp
        ? nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT),
          secure: Number(process.env.SMTP_PORT) === 465, // best-effort
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        })
        : nodemailer.createTransport({ jsonTransport: true });

      const fromAddress = process.env.SMTP_FROM || '"Sistema Interventi" <no-reply@demo.local>';

      const info = await transporter.sendMail({
        from: fromAddress,
        to: report.customerEmail,
        subject: `Bolla di Lavoro #${report.reportNumber} - Intervento #${report.interventionId}`,
        text: "In allegato la bolla di lavoro firmata per l'intervento odierno.",
        attachments: [
          {
            filename: `Bolla_Lavoro_${report.reportNumber}.pdf`,
            content: pdfBuffer,
          },
        ],
      });

      if (!hasSmtp) {
        console.log("SMTP non configurato: email simulata (jsonTransport).");
        console.log("Anteprima payload email:", info.messageId);
      }

      const updatedReport = await prisma.workReport.update({
        where: { interventionId },
        data: { emailedAt: new Date() }
      });

      res.json({ success: true, report: updatedReport });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: "Failed to send email" });
    }
  });

  // GET /api/attachments/:id/download (download/preview autenticato)
  app.get("/api/attachments/:id/download", allowTech, async (req, res) => {
    const attachmentId = String(req.params.id || "");
    const action = "attachments.download";
    let auditedEntity: AuditEntity = { attachmentId: attachmentId || null };
    try {
      if (!attachmentId) {
        auditLog(req, action, auditedEntity, "error", { status: 400 });
        return res.status(400).json({ error: "ID allegato non valido" });
      }
      const resolvedAttachment = await resolveAttachmentForDownload(attachmentId);
      if (!resolvedAttachment) {
        auditLog(req, action, auditedEntity, "not_found", { status: 404 });
        return res.status(404).json({ error: "Allegato non trovato" });
      }
      auditedEntity = {
        attachmentId: resolvedAttachment.id,
        interventionId: resolvedAttachment.interventionId
      };
      if (!userCanAccessIntervention(req.user, resolvedAttachment.access)) {
        auditLog(req, action, auditedEntity, "forbidden", { status: 403, source: resolvedAttachment.source });
        return res.status(403).json({ ok: false, error: "Non autorizzato" });
      }
      if (!isStoredAttachmentNameSafe(resolvedAttachment.storedName)) {
        auditLog(req, action, auditedEntity, "not_found", { status: 404, source: resolvedAttachment.source });
        return res.status(404).json({ error: "Allegato non trovato" });
      }
      const filePath = buildAttachmentFilePath(resolvedAttachment.storedName);
      if (!(await fileExistsReadable(filePath))) {
        auditLog(req, action, auditedEntity, "not_found", { status: 404, source: resolvedAttachment.source });
        return res.status(404).json({ error: "Allegato non trovato" });
      }
      res.setHeader("Content-Type", resolvedAttachment.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", buildContentDispositionHeader(resolvedAttachment.mimeType, resolvedAttachment.originalName));
      auditLog(req, action, auditedEntity, "success", { status: 200, source: resolvedAttachment.source });
      return res.sendFile(filePath);
    } catch (error) {
      auditLog(req, action, auditedEntity, "error", { status: 500 });
      logApiError(req, error);
      res.status(500).json({ ok: false, error: "Errore download allegato" });
    }
  });

  // GET /api/attachments/health (admin/dispatcher)
  app.get("/api/attachments/health", allowDispatcher, async (req, res) => {
    const action = "attachments.health";
    try {
      const dbTake = Math.max(1, Math.ceil((ATTACHMENTS_HEALTH_SCAN_LIMIT + 1) / 2));
      const [interventionRows, workReportRows] = await Promise.all([
        prisma.interventionAttachment.findMany({
          orderBy: { createdAt: "desc" },
          take: dbTake,
          select: { storedName: true }
        }),
        prisma.workReportAttachment.findMany({
          orderBy: { createdAt: "desc" },
          take: dbTake,
          select: { storedName: true }
        })
      ]);

      const dbCandidates = [...interventionRows, ...workReportRows];
      const dbScannedRows = dbCandidates.slice(0, ATTACHMENTS_HEALTH_SCAN_LIMIT);
      const missingFilesSample: string[] = [];
      let missingFilesInFsCount = 0;

      for (const row of dbScannedRows) {
        const safeName = path.basename(row.storedName || "");
        if (!isStoredAttachmentNameSafe(safeName)) continue;
        const filePath = buildAttachmentFilePath(safeName);
        const exists = await fileExistsReadable(filePath);
        if (!exists) {
          missingFilesInFsCount += 1;
          if (missingFilesSample.length < ATTACHMENTS_SAMPLE_LIMIT) {
            missingFilesSample.push(safeName);
          }
        }
      }

      const { names: fsNames, isPartial: fsPartial } = await listUploadFilesBounded(ATTACHMENTS_HEALTH_SCAN_LIMIT);
      const safeFsNames = fsNames.map((name) => path.basename(name)).filter(isStoredAttachmentNameSafe);
      const [fsInterventionRefs, fsWorkReportRefs] = await Promise.all([
        safeFsNames.length
          ? prisma.interventionAttachment.findMany({
              where: { storedName: { in: safeFsNames } },
              select: { storedName: true }
            })
          : Promise.resolve([] as Array<{ storedName: string }>),
        safeFsNames.length
          ? prisma.workReportAttachment.findMany({
              where: { storedName: { in: safeFsNames } },
              select: { storedName: true }
            })
          : Promise.resolve([] as Array<{ storedName: string }>)
      ]);

      const referencedFsNames = new Set<string>([
        ...fsInterventionRefs.map((row) => row.storedName),
        ...fsWorkReportRefs.map((row) => row.storedName)
      ]);
      const orphanFilesSample: string[] = [];
      let orphanFilesInFsCount = 0;
      for (const fileName of safeFsNames) {
        if (referencedFsNames.has(fileName)) continue;
        orphanFilesInFsCount += 1;
        if (orphanFilesSample.length < ATTACHMENTS_SAMPLE_LIMIT) {
          orphanFilesSample.push(fileName);
        }
      }

      const isPartial = fsPartial || dbCandidates.length > ATTACHMENTS_HEALTH_SCAN_LIMIT;
      auditLog(req, action, {}, "success", {
        status: 200,
        missingFilesInFsCount,
        orphanFilesInFsCount,
        scannedCount: dbScannedRows.length + fsNames.length,
        isPartial
      });
      return res.json({
        missingFilesInFsCount,
        orphanFilesInFsCount,
        scannedCount: dbScannedRows.length + fsNames.length,
        isPartial,
        missingFilesSample,
        orphanFilesSample
      });
    } catch (error) {
      auditLog(req, action, {}, "error", { status: 500 });
      logApiError(req, error);
      return res.status(500).json({ ok: false, error: "Errore health allegati" });
    }
  });

  // POST /api/attachments/cleanup (admin/dispatcher)
  app.post("/api/attachments/cleanup", allowDispatcher, async (req, res) => {
    const action = "attachments.cleanup";
    try {
      const minAgeDays = ATTACHMENTS_CLEANUP_MIN_AGE_DAYS;
      const cutoffMs = Date.now() - minAgeDays * 24 * 60 * 60 * 1000;
      const { names: fsNames, isPartial } = await listUploadFilesBounded(ATTACHMENTS_CLEANUP_SCAN_LIMIT);
      const safeFsNames = fsNames.map((name) => path.basename(name));

      const candidateForDelete: string[] = [];
      const errorsSample: string[] = [];
      let skippedCount = 0;
      let errorCount = 0;

      for (const fileName of safeFsNames) {
        if (!isStoredAttachmentNameSafe(fileName)) {
          skippedCount += 1;
          continue;
        }
        const filePath = buildAttachmentFilePath(fileName);
        try {
          const stat = await fsPromises.stat(filePath);
          if (!stat.isFile()) {
            skippedCount += 1;
            continue;
          }
          if (stat.mtimeMs > cutoffMs) {
            skippedCount += 1;
            continue;
          }
          candidateForDelete.push(fileName);
        } catch (error: any) {
          errorCount += 1;
          if (errorsSample.length < ATTACHMENTS_SAMPLE_LIMIT) {
            errorsSample.push(`${fileName}: ${error?.code || "STAT_FAILED"}`);
          }
        }
      }

      const [interventionRefs, workReportRefs] = await Promise.all([
        candidateForDelete.length
          ? prisma.interventionAttachment.findMany({
              where: { storedName: { in: candidateForDelete } },
              select: { storedName: true }
            })
          : Promise.resolve([] as Array<{ storedName: string }>),
        candidateForDelete.length
          ? prisma.workReportAttachment.findMany({
              where: { storedName: { in: candidateForDelete } },
              select: { storedName: true }
            })
          : Promise.resolve([] as Array<{ storedName: string }>)
      ]);

      const referenced = new Set<string>([
        ...interventionRefs.map((row) => row.storedName),
        ...workReportRefs.map((row) => row.storedName)
      ]);

      let deletedCount = 0;
      for (const fileName of candidateForDelete) {
        if (referenced.has(fileName)) {
          skippedCount += 1;
          continue;
        }
        const filePath = buildAttachmentFilePath(fileName);
        try {
          await fsPromises.unlink(filePath);
          deletedCount += 1;
        } catch (error: any) {
          errorCount += 1;
          if (errorsSample.length < ATTACHMENTS_SAMPLE_LIMIT) {
            errorsSample.push(`${fileName}: ${error?.code || "DELETE_FAILED"}`);
          }
        }
      }

      auditLog(req, action, {}, "success", {
        status: 200,
        deletedCount,
        skippedCount,
        errorCount,
        isPartial
      });
      return res.json({
        deletedCount,
        skippedCount,
        errorCount,
        errorsSample,
        isPartial
      });
    } catch (error) {
      auditLog(req, action, {}, "error", { status: 500 });
      logApiError(req, error);
      return res.status(500).json({ ok: false, error: "Errore cleanup allegati" });
    }
  });

  // --- Centralized Error Handler ---
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const isMalformedUrlError =
      err instanceof URIError ||
      (typeof err?.message === "string" && err.message.toLowerCase().includes("uri malformed"));
    if (isMalformedUrlError) {
      console.warn(`[API Warn] reqId=${req.requestId || "-"} route=${req.method} ${req.originalUrl} malformed_url`);
      return sendError(res, 400, "URL non valida", "MALFORMED_URL");
    }
    // Hide stack trace in production but log it internally
    console.error(`[API Error] reqId=${req.requestId || "-"} route=${req.method} ${req.originalUrl}`, err.stack || err);
    if (err instanceof z.ZodError) {
      return sendError(res, 400, "Dati non validi", "VALIDATION_ERROR", { details: err.issues });
    }
    const isProd = process.env.NODE_ENV === "production";
    return res.status(500).json({
      ok: false,
      error: "Errore interno del server",
      code: "INTERNAL_ERROR",
      ...(isProd ? {} : { message: err.message })
    });
  });

  // --- CUSTOMERS ---

  const normalizeTaxCode = (value: string | null | undefined) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const normalized = value.replace(/\s+/g, '').toUpperCase().trim();
    return normalized || null;
  };

  const normalizeVatNumber = (value: string | null | undefined) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const normalized = value.replace(/\s+/g, '').trim();
    return normalized || null;
  };

  const normalizeCustomerPhone = (value: string | null | undefined) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const normalized = value.trim();
    return normalized || null;
  };

  const buildCustomerPhoneDuplicateOrConditions = (phones: Array<string | null | undefined>): Prisma.CustomerWhereInput[] => {
    const dedupedPhones = [...new Set(phones.filter((phone): phone is string => Boolean(phone && phone.trim())))];
    const conditions: Prisma.CustomerWhereInput[] = [];
    for (const phone of dedupedPhones) {
      conditions.push({ phone1: phone });
      conditions.push({ phone2: phone });
    }
    return conditions;
  };

  const customerSchema = z.object({
    name: z.string().trim().min(1, "Name is required"),
    companyName: z.string().trim().optional().nullable(),
    customerType: z.enum(["PRIVATO", "AZIENDA"]).optional(),
    preferredTimeSlot: z.enum(["MATTINA", "PRANZO", "POMERIGGIO", "SERA", "INDIFFERENTE"]).optional(),
    email: z.string().trim().email().optional().or(z.literal('')).nullable(),
    phone1: z.string().trim().optional().nullable(),
    phone2: z.string().trim().optional().nullable(),
    taxCode: z.string().trim().optional().nullable(),
    vatNumber: z.string().trim().optional().nullable(),
    addressLine: z.string().trim().optional().nullable(),
    physicalAddress: z.string().trim().max(300).optional().nullable(),
    intercomInfo: z.string().trim().max(200).optional().nullable(),
    intercomLabel: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
    isActive: z.boolean().optional()
  });

  const siteSchema = z.object({
    label: z.string().trim().optional().nullable(),
    address: z.string().trim().min(1, "Address is required"),
    startDate: z.string().trim().optional().nullable(),
    endDate: z.string().trim().optional().nullable()
  }).strict();

  const jobCreateSchema = z.object({
    code: z.string().trim().optional().nullable(),
    title: z.string().trim().min(1, "Title is required"),
    description: z.string().trim().optional().nullable(),
    status: z.enum(["OPEN", "PAUSED", "CLOSED", "ARCHIVED"]).optional(),
    startDate: z.string().trim().optional().nullable(),
    endDate: z.string().trim().optional().nullable()
  }).strict();

  const jobPatchSchema = z.object({
    code: z.string().trim().optional().nullable(),
    title: z.string().trim().min(1, "Title is required").optional(),
    description: z.string().trim().optional().nullable(),
    status: z.enum(["OPEN", "PAUSED", "CLOSED", "ARCHIVED"]).optional(),
    startDate: z.string().trim().optional().nullable(),
    endDate: z.string().trim().optional().nullable()
  }).strict();

  app.get('/api/customers', allowDispatcher, async (req, res) => {
    try {
      const search = (req.query.q as string) || (req.query.search as string);
      let whereCondition: any = { isActive: true };

      if (search) {
        whereCondition = {
          isActive: true,
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { phone1: { contains: search, mode: 'insensitive' } },
            { phone2: { contains: search, mode: 'insensitive' } },
            { companyName: { contains: search, mode: 'insensitive' } },
            { notes: { contains: search, mode: 'insensitive' } },
            { intercomInfo: { contains: search, mode: 'insensitive' } },
            { intercomLabel: { contains: search, mode: 'insensitive' } }
          ]
        };
      }

      // Fallback: don't crash, return array
      const customers = await prisma.customer.findMany({
        where: whereCondition,
        orderBy: { name: 'asc' },
        take: 50
      });
      res.json(customers);
    } catch (error) {
      console.error(error);
      res.json([]); // returns empty array on failure as per specs
    }
  });

  app.get('/api/customers/:id', allowDispatcher, async (req, res) => {
    try {
      const customer = await prisma.customer.findUnique({
        where: { id: req.params.id }
      });
      if (!customer) return res.status(404).json({ error: 'Customer not found' });
      res.json(customer);
    } catch (error) {
      res.status(500).json({ ok: false, error: 'Error fetching customer' });
    }
  });

  app.get('/api/customers/:customerId/sites', allowDispatcher, async (req, res) => {
    try {
      const customerId = req.params.customerId;
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true }
      });
      if (!customer) return res.status(404).json({ error: 'Customer not found' });

      const sites = await prisma.site.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' }
      });
      res.json(sites);
    } catch (error) {
      res.status(500).json({ ok: false, error: 'Error fetching customer sites' });
    }
  });

  app.post('/api/customers/:customerId/sites', allowDispatcher, async (req, res) => {
    try {
      const customerId = req.params.customerId;
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true }
      });
      if (!customer) return res.status(404).json({ error: 'Customer not found' });

      const data = siteSchema.parse(req.body);

      const parseOptionalSiteDate = (value: string | null | undefined) => {
        if (!value) return null;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return undefined;
        return parsed;
      };

      const startDate = parseOptionalSiteDate(data.startDate);
      if (data.startDate && startDate === undefined) {
        return res.status(400).json({ error: 'startDate non valida' });
      }
      const endDate = parseOptionalSiteDate(data.endDate);
      if (data.endDate && endDate === undefined) {
        return res.status(400).json({ error: 'endDate non valida' });
      }

      const newSite = await prisma.site.create({
        data: {
          customerId,
          label: data.label ?? null,
          address: data.address,
          startDate: (startDate ?? null) as Date | null,
          endDate: (endDate ?? null) as Date | null
        }
      });
      res.status(201).json(newSite);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ errors: (error as any).errors || error.issues });
      }
      res.status(500).json({ ok: false, error: 'Error creating customer site' });
    }
  });

  app.get('/api/sites/:siteId/jobs', allowDispatcher, async (req, res) => {
    try {
      const siteId = req.params.siteId;
      const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: { id: true }
      });
      if (!site) return res.status(404).json({ error: 'Site not found' });

      const jobs = await prisma.job.findMany({
        where: { siteId },
        orderBy: { createdAt: 'desc' }
      });
      return res.json(jobs);
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Error fetching site jobs' });
    }
  });

  app.post('/api/sites/:siteId/jobs', allowDispatcher, async (req, res) => {
    try {
      const siteId = req.params.siteId;
      const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: { id: true }
      });
      if (!site) return res.status(404).json({ error: 'Site not found' });

      const data = jobCreateSchema.parse(req.body);

      const parseOptionalJobDate = (value: string | null | undefined) => {
        if (!value) return null;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return undefined;
        return parsed;
      };

      const startDate = parseOptionalJobDate(data.startDate);
      if (data.startDate && startDate === undefined) {
        return res.status(400).json({ error: 'startDate non valida' });
      }
      const endDate = parseOptionalJobDate(data.endDate);
      if (data.endDate && endDate === undefined) {
        return res.status(400).json({ error: 'endDate non valida' });
      }

      const newJob = await prisma.job.create({
        data: {
          siteId,
          code: data.code ?? null,
          title: data.title,
          description: data.description ?? null,
          status: data.status ?? "OPEN",
          startDate: (startDate ?? null) as Date | null,
          endDate: (endDate ?? null) as Date | null
        }
      });
      return res.status(201).json(newJob);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ errors: (error as any).errors || error.issues });
      }
      return res.status(500).json({ ok: false, error: 'Error creating job' });
    }
  });

  app.patch('/api/jobs/:id', allowDispatcher, async (req, res) => {
    try {
      const id = req.params.id;
      const data = jobPatchSchema.parse(req.body);

      const parseOptionalJobDate = (value: string | null | undefined) => {
        if (value === undefined) return undefined;
        if (!value) return null;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return undefined;
        return parsed;
      };

      const updateData: any = {};
      if (Object.prototype.hasOwnProperty.call(data, 'code')) updateData.code = data.code ?? null;
      if (Object.prototype.hasOwnProperty.call(data, 'title')) updateData.title = data.title;
      if (Object.prototype.hasOwnProperty.call(data, 'description')) updateData.description = data.description ?? null;
      if (Object.prototype.hasOwnProperty.call(data, 'status')) updateData.status = data.status;
      if (Object.prototype.hasOwnProperty.call(data, 'startDate')) {
        const startDate = parseOptionalJobDate(data.startDate);
        if (data.startDate && startDate === undefined) {
          return res.status(400).json({ error: 'startDate non valida' });
        }
        updateData.startDate = startDate === undefined ? undefined : startDate;
      }
      if (Object.prototype.hasOwnProperty.call(data, 'endDate')) {
        const endDate = parseOptionalJobDate(data.endDate);
        if (data.endDate && endDate === undefined) {
          return res.status(400).json({ error: 'endDate non valida' });
        }
        updateData.endDate = endDate === undefined ? undefined : endDate;
      }

      const updated = await prisma.job.update({
        where: { id },
        data: updateData
      });
      return res.json(updated);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ errors: (error as any).errors || error.issues });
      }
      if (error?.code === 'P2025') {
        return res.status(404).json({ error: 'Job not found' });
      }
      return res.status(500).json({ ok: false, error: 'Error updating job' });
    }
  });

  app.get('/api/jobs/:id/interventions', allowDispatcher, async (req, res) => {
    try {
      const id = req.params.id;
      const job = await prisma.job.findUnique({
        where: { id },
        select: { id: true }
      });
      if (!job) return res.status(404).json({ error: 'Job not found' });

      const interventions = await prisma.intervention.findMany({
        where: { jobId: id },
        orderBy: { createdAt: 'desc' }
      });
      return res.json(interventions);
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Error fetching job interventions' });
    }
  });

  app.post('/api/customers', allowDispatcher, async (req, res) => {
    try {
      const data = customerSchema.parse(req.body);
      const normalizedData = {
        ...data,
        phone1: normalizeCustomerPhone(data.phone1),
        phone2: normalizeCustomerPhone(data.phone2),
        taxCode: normalizeTaxCode(data.taxCode),
        vatNumber: normalizeVatNumber(data.vatNumber)
      };

      const phoneDuplicateOrConditions = buildCustomerPhoneDuplicateOrConditions([
        normalizedData.phone1,
        normalizedData.phone2
      ]);
      if (phoneDuplicateOrConditions.length > 0) {
        const existingPhoneCustomer = await prisma.customer.findFirst({
          where: { OR: phoneDuplicateOrConditions }
        });
        if (existingPhoneCustomer) {
          return res.status(409).json({ error: 'Cliente già presente', data: existingPhoneCustomer });
        }
      }

      // Dedup logic: check if existing email or taxCode
      const OR_conditions: Prisma.CustomerWhereInput[] = [];
      if (normalizedData.email) OR_conditions.push({ email: normalizedData.email });
      if (normalizedData.taxCode) OR_conditions.push({ taxCode: normalizedData.taxCode });

      if (OR_conditions.length > 0) {
        const existing = await prisma.customer.findFirst({
          where: { OR: OR_conditions }
        });
        if (existing) {
          if (!existing.isActive) {
            const reactivated = await prisma.customer.update({
              where: { id: existing.id },
              data: {
                ...normalizedData,
                isActive: true
              }
            });
            return res.status(200).json(reactivated);
          }
          return res.status(409).json({ error: 'Cliente già presente', data: existing });
        }
      }

      const newCustomer = await prisma.customer.create({ data: normalizedData });
      res.status(201).json(newCustomer);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target)
          ? error.meta?.target.join(', ')
          : String(error.meta?.target || '');
        return res.status(409).json({
          error: 'Cliente già presente',
          message: target ? `Valore già usato per: ${target}` : 'Valori univoci già presenti'
        });
      }
      if (error instanceof z.ZodError) {
        return res.status(400).json({ errors: (error as any).errors || error.issues });
      }
      console.error(error);
      res.status(500).json({ ok: false, error: 'Error creating customer' });
    }
  });

  app.patch('/api/customers/:id', allowDispatcher, async (req, res) => {
    try {
      const data = customerSchema.partial().parse(req.body);
      const normalizedData = {
        ...data,
        phone1: normalizeCustomerPhone(data.phone1),
        phone2: normalizeCustomerPhone(data.phone2),
        taxCode: normalizeTaxCode(data.taxCode),
        vatNumber: normalizeVatNumber(data.vatNumber)
      };
      const phoneDuplicateOrConditions = buildCustomerPhoneDuplicateOrConditions([
        normalizedData.phone1,
        normalizedData.phone2
      ]);
      if (phoneDuplicateOrConditions.length > 0) {
        const existingCustomer = await prisma.customer.findFirst({
          where: {
            id: { not: req.params.id },
            OR: phoneDuplicateOrConditions
          }
        });
        if (existingCustomer) {
          return res.status(409).json({ error: 'Cliente già presente', data: existingCustomer });
        }
      }
      const updated = await prisma.customer.update({
        where: { id: req.params.id },
        data: normalizedData
      });
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ errors: (error as any).errors || error.issues });
      }
      res.status(500).json({ ok: false, error: 'Error updating customer' });
    }
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  if (process.env.NODE_ENV === "production") {
    const distDir = path.join(__dirname, "dist");
    app.use(express.static(distDir, { index: false }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(path.join(distDir, "index.html"), (err) => {
        if (err) next(err);
      });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
