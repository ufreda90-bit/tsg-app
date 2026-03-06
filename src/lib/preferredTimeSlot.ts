import type { PreferredTimeSlot } from "../types";

const SLOT_ORDER = ["MATTINA", "PRANZO", "POMERIGGIO", "SERA"] as const;
type OrderedPreferredTimeSlot = (typeof SLOT_ORDER)[number];

const SLOT_TO_TIME: Record<OrderedPreferredTimeSlot, string> = {
  MATTINA: "09:00",
  PRANZO: "12:30",
  POMERIGGIO: "15:00",
  SERA: "18:00"
};

function toLocalDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function timeToMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function suggestStartTimeFromPreferredSlot(params: {
  preferredTimeSlot?: PreferredTimeSlot | null;
  scheduledDate?: string | null;
  now?: Date;
}) {
  const { preferredTimeSlot, scheduledDate } = params;
  const now = params.now ?? new Date();

  if (!preferredTimeSlot || preferredTimeSlot === "INDIFFERENTE") {
    return null;
  }
  if (!scheduledDate) {
    return null;
  }

  let slotIndex = SLOT_ORDER.indexOf(preferredTimeSlot as OrderedPreferredTimeSlot);
  if (slotIndex < 0) {
    return null;
  }

  if (scheduledDate === toLocalDateKey(now)) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    while (slotIndex < SLOT_ORDER.length) {
      const slot = SLOT_ORDER[slotIndex];
      const slotMinutes = timeToMinutes(SLOT_TO_TIME[slot]);
      if (slotMinutes >= nowMinutes) {
        break;
      }
      slotIndex += 1;
    }

    if (slotIndex >= SLOT_ORDER.length) {
      return null;
    }
  }

  return SLOT_TO_TIME[SLOT_ORDER[slotIndex]];
}

export function addMinutesToClockTime(hhmm: string, minutesToAdd: number) {
  const [hours, minutes] = hhmm.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }
  const total = (hours * 60 + minutes + minutesToAdd) % (24 * 60);
  const normalized = total < 0 ? total + 24 * 60 : total;
  const nextHours = String(Math.floor(normalized / 60)).padStart(2, "0");
  const nextMinutes = String(normalized % 60).padStart(2, "0");
  return `${nextHours}:${nextMinutes}`;
}
