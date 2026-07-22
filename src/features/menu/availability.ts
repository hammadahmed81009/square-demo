import Decimal from "decimal.js";
import { DateTime } from "luxon";

import type {
  CategoryDto,
  MenuItemDto,
  MenuSnapshotDto,
  MenuVariationDto,
  WeeklyIntervalDto,
} from "@/shared/contracts";

export type OrderabilityReason =
  | "offline_or_stale"
  | "invalid_location_timezone"
  | "location_closed"
  | "category_schedule_closed"
  | "variation_not_sellable"
  | "sold_out"
  | "modifier_configuration_invalid"
  | "orderable";

export interface WeeklySchedulePeriod {
  readonly dayOfWeek: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
  readonly endLocalTime: string;
  readonly startLocalTime: string;
}

export interface InventoryResolutionInput {
  readonly calculatedAt?: string | null;
  readonly globalTrackInventory?: boolean | null;
  readonly inventoryAvailable: boolean;
  readonly locationSoldOut?: boolean | null;
  readonly locationTrackInventory?: boolean | null;
  readonly now: Date;
  readonly quantity?: string | null;
  readonly soldOutValidUntil?: string | null;
}

export interface InventoryResolution {
  readonly inventoryState: MenuVariationDto["inventoryState"];
  readonly inventoryUpdatedAt: string | null;
  readonly soldOutUntil: string | null;
  readonly trackingEnabled: boolean;
}

export interface VariationOrderability {
  readonly id: string;
  readonly nextOpening: string | null;
  readonly orderable: boolean;
  readonly reason: OrderabilityReason;
}

export interface ItemOrderability {
  readonly id: string;
  readonly nextOpening: string | null;
  readonly orderable: boolean;
  readonly reason: OrderabilityReason;
  readonly variations: readonly VariationOrderability[];
}

export interface MenuOrderabilityInput {
  readonly isOnline: boolean;
  readonly isSnapshotFresh: boolean;
  readonly now: Date;
  readonly snapshot: MenuSnapshotDto;
}

export interface MenuOrderability {
  readonly items: readonly ItemOrderability[];
  readonly locationNextOpening: string | null;
  readonly locationOpen: boolean | null;
  readonly evaluatedAt: string;
}

const DAY_START_MINUTES: Readonly<Record<WeeklySchedulePeriod["dayOfWeek"], number>> = {
  MON: 0,
  TUE: 1_440,
  WED: 2_880,
  THU: 4_320,
  FRI: 5_760,
  SAT: 7_200,
  SUN: 8_640,
};

const REASON_PRIORITY: Readonly<Record<OrderabilityReason, number>> = {
  offline_or_stale: 0,
  invalid_location_timezone: 1,
  location_closed: 2,
  category_schedule_closed: 3,
  variation_not_sellable: 4,
  sold_out: 5,
  modifier_configuration_invalid: 6,
  orderable: 7,
};

function minuteOfDay(value: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (match === null) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);
  if (hour > 23 || minute > 59 || seconds !== 0) {
    return null;
  }
  return hour * 60 + minute;
}

function compareIntervals(left: WeeklyIntervalDto, right: WeeklyIntervalDto): number {
  return left.startMinute - right.startMinute || left.endMinute - right.endMinute;
}

/** Keep day-boundary-adjacent intervals separate to preserve overnight splits. */
export function mergeWeeklyIntervals(
  intervals: readonly WeeklyIntervalDto[],
): WeeklyIntervalDto[] {
  const merged: WeeklyIntervalDto[] = [];
  for (const interval of [...intervals].sort(compareIntervals)) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && interval.startMinute < previous.endMinute) {
      previous.endMinute = Math.max(previous.endMinute, interval.endMinute);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

export function intersectWeeklyIntervals(
  left: readonly WeeklyIntervalDto[] | null,
  right: readonly WeeklyIntervalDto[] | null,
): WeeklyIntervalDto[] | null {
  if (left === null) {
    return right === null ? null : [...right];
  }
  if (right === null) {
    return [...left];
  }
  const result: WeeklyIntervalDto[] = [];
  for (const leftInterval of left) {
    for (const rightInterval of right) {
      const startMinute = Math.max(leftInterval.startMinute, rightInterval.startMinute);
      const endMinute = Math.min(leftInterval.endMinute, rightInterval.endMinute);
      if (endMinute > startMinute) {
        result.push({ startMinute, endMinute });
      }
    }
  }
  return mergeWeeklyIntervals(result);
}

/**
 * Converts weekly local periods into non-wrapping Monday-based intervals.
 * Invalid or equal start/end periods fail closed by returning an empty list.
 */
export function normalizeWeeklyPeriods(
  periods: readonly WeeklySchedulePeriod[],
): WeeklyIntervalDto[] {
  const intervals: WeeklyIntervalDto[] = [];
  for (const period of periods) {
    const start = minuteOfDay(period.startLocalTime);
    const end = minuteOfDay(period.endLocalTime);
    const dayStart = DAY_START_MINUTES[period.dayOfWeek];
    if (start === null || end === null || start === end) {
      return [];
    }
    if (end > start) {
      intervals.push({ startMinute: dayStart + start, endMinute: dayStart + end });
      continue;
    }
    intervals.push({ startMinute: dayStart + start, endMinute: dayStart + 1_440 });
    const nextDayStart = (dayStart + 1_440) % 10_080;
    intervals.push({ startMinute: nextDayStart, endMinute: nextDayStart + end });
  }
  return mergeWeeklyIntervals(intervals);
}

function isWithinWindows(
  weeklyMinute: number,
  windows: readonly WeeklyIntervalDto[] | null,
): boolean {
  return windows === null || windows.some(
    (window) => weeklyMinute >= window.startMinute && weeklyMinute < window.endMinute,
  );
}

function validLocationTime(snapshot: MenuSnapshotDto, now: Date): DateTime | null {
  if (snapshot.location.timezoneStatus !== "valid" || snapshot.location.timezone === null) {
    return null;
  }
  const local = DateTime.fromJSDate(now, { zone: snapshot.location.timezone });
  return local.isValid ? local : null;
}

function weeklyMinute(local: DateTime): number {
  return (local.weekday - 1) * 1_440 + local.hour * 60 + local.minute;
}

function nextOpening(
  local: DateTime,
  windows: readonly WeeklyIntervalDto[] | null,
): string | null {
  if (windows === null) {
    return local.toISO();
  }
  const oneWeekLater = local.plus({ days: 7 });
  const startOfWeek = local.startOf("week");
  let next: DateTime | null = null;
  for (let weekOffset = 0; weekOffset < 2; weekOffset += 1) {
    for (const window of windows) {
      const candidate = startOfWeek.plus({ weeks: weekOffset, minutes: window.startMinute });
      if (candidate <= local || candidate > oneWeekLater) {
        continue;
      }
      if (next === null || candidate < next) {
        next = candidate;
      }
    }
  }
  return next?.toISO() ?? null;
}

function categoryWindows(
  categories: readonly CategoryDto[],
  categoryIds: readonly string[],
): readonly WeeklyIntervalDto[] | null {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const paths: Array<readonly WeeklyIntervalDto[] | null> = [];
  for (const categoryId of categoryIds) {
    const visited = new Set<string>();
    let currentId: string | null = categoryId;
    let pathWindows: readonly WeeklyIntervalDto[] | null = null;
    let validPath = true;
    while (currentId !== null) {
      if (visited.has(currentId)) {
        validPath = false;
        break;
      }
      visited.add(currentId);
      const category = byId.get(currentId);
      if (category === undefined) {
        validPath = false;
        break;
      }
      pathWindows = intersectWeeklyIntervals(pathWindows, category.scheduleWindows);
      currentId = category.parentId;
    }
    paths.push(validPath ? pathWindows : []);
  }
  if (paths.some((path) => path === null)) {
    return null;
  }
  return mergeWeeklyIntervals(paths.flatMap((path) => path ?? []));
}

/** Resolves category ancestors and unions alternate item category paths. */
export function resolveItemScheduleWindows(
  snapshot: MenuSnapshotDto,
  item: MenuItemDto,
): readonly WeeklyIntervalDto[] | null {
  const fromHierarchy = categoryWindows(snapshot.categories, item.categoryIds);
  return item.scheduleWindows ?? fromHierarchy;
}

function validIso(value: string | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return value;
}

/** Exact decimal inventory resolution without converting quantity to a float. */
export function resolveInventoryState(
  input: InventoryResolutionInput,
): InventoryResolution {
  const trackingEnabled = input.locationTrackInventory ?? input.globalTrackInventory ?? false;
  const soldOutUntil = validIso(input.soldOutValidUntil);
  const soldOutStillValid = input.locationSoldOut === true && (
    soldOutUntil === null || Date.parse(soldOutUntil) > input.now.getTime()
  );
  if (soldOutStillValid) {
    return {
      inventoryState: "sold_out",
      inventoryUpdatedAt: validIso(input.calculatedAt),
      soldOutUntil,
      trackingEnabled,
    };
  }
  if (!trackingEnabled) {
    return {
      inventoryState: "untracked",
      inventoryUpdatedAt: validIso(input.calculatedAt),
      soldOutUntil,
      trackingEnabled,
    };
  }
  if (!input.inventoryAvailable || input.quantity === null || input.quantity === undefined) {
    return {
      inventoryState: "unknown",
      inventoryUpdatedAt: validIso(input.calculatedAt),
      soldOutUntil,
      trackingEnabled,
    };
  }
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input.quantity)) {
    return {
      inventoryState: "unknown",
      inventoryUpdatedAt: validIso(input.calculatedAt),
      soldOutUntil,
      trackingEnabled,
    };
  }
  try {
    const quantity = new Decimal(input.quantity);
    if (!quantity.isFinite()) {
      throw new Error("Inventory quantity is not finite");
    }
    return {
      inventoryState: quantity.lte(0) ? "sold_out" : "in_stock",
      inventoryUpdatedAt: validIso(input.calculatedAt),
      soldOutUntil,
      trackingEnabled,
    };
  } catch {
    return {
      inventoryState: "unknown",
      inventoryUpdatedAt: validIso(input.calculatedAt),
      soldOutUntil,
      trackingEnabled,
    };
  }
}

function variationReason(
  variation: MenuVariationDto,
  item: MenuItemDto,
): OrderabilityReason {
  if (
    !variation.sellable ||
    variation.pricingStatus !== "fixed" ||
    variation.price === null
  ) {
    return "variation_not_sellable";
  }
  if (variation.inventoryState === "sold_out") {
    return "sold_out";
  }
  if (item.modifierConfigurationError !== null) {
    return "modifier_configuration_invalid";
  }
  return "orderable";
}

function itemReason(variations: readonly VariationOrderability[]): OrderabilityReason {
  if (variations.some((variation) => variation.reason === "orderable")) {
    return "orderable";
  }
  return variations.reduce<OrderabilityReason>(
    (current, variation) =>
      REASON_PRIORITY[variation.reason] < REASON_PRIORITY[current]
        ? variation.reason
        : current,
    "orderable",
  );
}

/** Returns the first instant after now at which UI availability should be reevaluated. */
export function nextMinuteBoundary(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000 + 60_000);
}

/**
 * Applies the locked orderability precedence to every location-visible menu
 * variation. The function is deterministic for its supplied snapshot and clock.
 */
export function evaluateMenuOrderability(
  input: MenuOrderabilityInput,
): MenuOrderability {
  const evaluatedAt = input.now.toISOString();
  const local = validLocationTime(input.snapshot, input.now);
  const locationWindows = input.snapshot.location.businessHours;
  const locationOpen = local === null ? null : isWithinWindows(weeklyMinute(local), locationWindows);
  const locationNextOpening = local === null || locationOpen
    ? null
    : nextOpening(local, locationWindows);
  const globalReason: OrderabilityReason | null = !input.isOnline || !input.isSnapshotFresh
    ? "offline_or_stale"
    : local === null
      ? "invalid_location_timezone"
      : locationOpen
        ? null
        : "location_closed";

  const items = input.snapshot.items.map((item) => {
    const scheduleWindows = resolveItemScheduleWindows(input.snapshot, item);
    const categoryOpen = local === null ? false : isWithinWindows(weeklyMinute(local), scheduleWindows);
    const categoryNextOpening = local === null || categoryOpen
      ? null
      : nextOpening(local, intersectWeeklyIntervals(locationWindows, scheduleWindows));
    const schedulingReason: OrderabilityReason | null = globalReason ?? (
      categoryOpen ? null : "category_schedule_closed"
    );
    const variations = item.variations.map((variation) => {
      const reason = schedulingReason ?? variationReason(variation, item);
      return {
        id: variation.id,
        nextOpening: reason === "location_closed"
          ? locationNextOpening
          : reason === "category_schedule_closed"
            ? categoryNextOpening
            : null,
        orderable: reason === "orderable",
        reason,
      };
    });
    const reason = schedulingReason ?? itemReason(variations);
    return {
      id: item.id,
      nextOpening: reason === "location_closed"
        ? locationNextOpening
        : reason === "category_schedule_closed"
          ? categoryNextOpening
          : null,
      orderable: reason === "orderable",
      reason,
      variations,
    };
  });

  return { evaluatedAt, items, locationNextOpening, locationOpen };
}
