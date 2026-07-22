import "server-only";

import {
  identifierSchema,
  isoDateTimeSchema,
  locationSchema,
  menuSnapshotSchema,
  type CategoryDto,
  type MenuItemDto,
  type MenuSnapshotDto,
  type MoneyDto,
  type WarningDto,
  type WeeklyIntervalDto,
  PUBLIC_SCHEMA_VERSION,
} from "@/shared/contracts";
import { resolveInventoryState } from "@/features/menu/availability";

type RawRecord = Record<string, unknown>;

const OTHER_CATEGORY_ID = "OTHER";
const OTHER_CATEGORY: CategoryDto = {
  id: OTHER_CATEGORY_ID,
  kind: "synthetic",
  name: "Other",
  ordinal: 2_147_483_647,
  parentId: null,
  scheduleWindows: null,
};

const DAY_START_MINUTES: Readonly<Record<string, number>> = {
  MON: 0,
  TUE: 1_440,
  WED: 2_880,
  THU: 4_320,
  FRI: 5_760,
  SAT: 7_200,
  SUN: 8_640,
};

export interface MenuNormalizationInput {
  readonly catalog: readonly unknown[];
  readonly generatedAt?: Date;
  readonly inventory?: readonly unknown[];
  readonly inventoryStatus?: "fresh" | "partial" | "unavailable";
  readonly location: unknown;
}

export interface MenuNormalizationResult {
  readonly snapshot: MenuSnapshotDto;
  readonly warnings: readonly WarningDto[];
}

export class MenuNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MenuNormalizationError";
  }
}

interface CatalogIndex {
  readonly byId: ReadonlyMap<string, RawRecord>;
  readonly warnings: readonly WarningDto[];
}

interface CategorySeed {
  readonly id: string;
  readonly kind: "menu" | "regular";
  readonly name: string;
  readonly ordinal: number;
  readonly ownSchedule: readonly WeeklyIntervalDto[] | null;
  readonly parentId: string | null;
}

interface PreparedItem {
  readonly categoryIds: readonly string[];
  readonly description: string;
  readonly id: string;
  readonly imageUrl: string | null;
  readonly modifierConfigurationError: string | null;
  readonly modifierGroups: MenuItemDto["modifierGroups"];
  readonly name: string;
  readonly ordinal: number;
  readonly variations: MenuItemDto["variations"];
}

interface InventoryObservation {
  readonly calculatedAt: string | null;
  readonly quantity: string;
}

function asRecord(value: unknown): RawRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RawRecord)
    : null;
}

function field(record: RawRecord, ...names: readonly string[]): unknown {
  for (const name of names) {
    if (name in record) {
      return record[name];
    }
  }
  return undefined;
}

function stringField(record: RawRecord, ...names: readonly string[]): string | null {
  const value = field(record, ...names);
  return typeof value === "string" ? value.trim() : null;
}

function booleanField(record: RawRecord, ...names: readonly string[]): boolean | null {
  const value = field(record, ...names);
  return typeof value === "boolean" ? value : null;
}

function arrayField(record: RawRecord, ...names: readonly string[]): readonly unknown[] {
  const value = field(record, ...names);
  return Array.isArray(value) ? value : [];
}

function integerField(record: RawRecord, ...names: readonly string[]): number | null {
  const value = field(record, ...names);
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function validId(value: unknown): string | null {
  const parsed = identifierSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortByOrdinalNameAndId<T extends { id: string; name: string; ordinal: number }>(
  values: readonly T[],
): T[] {
  return [...values].sort(
    (left, right) =>
      left.ordinal - right.ordinal ||
      compareText(left.name, right.name) ||
      compareText(left.id, right.id),
  );
}

function warningCollector(): {
  readonly add: (code: string, message: string) => void;
  readonly values: () => readonly WarningDto[];
} {
  const keys = new Set<string>();
  const warnings: WarningDto[] = [];

  return {
    add(code, message): void {
      const key = `${code}:${message}`;
      if (!keys.has(key)) {
        keys.add(key);
        warnings.push({ code, message });
      }
    },
    values(): readonly WarningDto[] {
      return warnings;
    },
  };
}

function isDeleted(record: RawRecord): boolean {
  return booleanField(record, "is_deleted", "isDeleted") === true;
}

function sourceVersion(record: RawRecord): bigint {
  const value = field(record, "version");
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return BigInt(0);
}

function indexCatalog(
  catalog: readonly unknown[],
  addWarning: (code: string, message: string) => void,
): CatalogIndex {
  const byId = new Map<string, RawRecord>();

  for (const rawObject of catalog) {
    const record = asRecord(rawObject);
    const id = record === null ? null : validId(field(record, "id"));
    if (record === null || id === null) {
      addWarning("MALFORMED_CATALOG_OBJECT", "A malformed catalog object was omitted.");
      continue;
    }

    const existing = byId.get(id);
    if (existing === undefined) {
      byId.set(id, record);
      continue;
    }

    addWarning("DUPLICATE_CATALOG_ID", "Duplicate catalog IDs were resolved deterministically.");
    if (sourceVersion(record) > sourceVersion(existing)) {
      byId.set(id, record);
    }
  }

  return { byId, warnings: [] };
}

function presenceAtLocation(record: RawRecord, locationId: string): boolean {
  const presentAtAll = booleanField(
    record,
    "present_at_all_locations",
    "presentAtAllLocations",
  );
  const presentIds = arrayField(
    record,
    "present_at_location_ids",
    "presentAtLocationIds",
  )
    .map(validId)
    .filter((id): id is string => id !== null);
  const absentIds = arrayField(
    record,
    "absent_at_location_ids",
    "absentAtLocationIds",
  )
    .map(validId)
    .filter((id): id is string => id !== null);

  if (presentAtAll === false) {
    return presentIds.includes(locationId);
  }

  // Square defaults catalog objects to all locations when the flag is absent.
  return !absentIds.includes(locationId);
}

/** Normalize one active Square location into the public DTO shape. */
export function normalizeLocation(raw: unknown): MenuSnapshotDto["location"] {
  const record = asRecord(raw);
  if (record === null) {
    throw new MenuNormalizationError("The selected location is malformed.");
  }

  const id = validId(field(record, "id"));
  const name = stringField(record, "name");
  const currency = stringField(record, "currency")?.toUpperCase() ?? null;
  if (id === null || name === null || currency === null || !/^[A-Z]{3}$/.test(currency)) {
    throw new MenuNormalizationError("The selected location is missing required configuration.");
  }

  const address = asRecord(field(record, "address"));
  const addressLines = address === null
    ? []
    : [
        stringField(address, "address_line_1", "addressLine1"),
        stringField(address, "address_line_2", "addressLine2"),
        [
          stringField(address, "locality"),
          stringField(address, "administrative_district_level_1", "administrativeDistrictLevel1"),
          stringField(address, "postal_code", "postalCode"),
        ]
          .filter((part): part is string => part !== null)
          .join(", "),
      ].filter((line): line is string => typeof line === "string" && line.length > 0);
  const rawTimezone = stringField(record, "timezone");
  let timezone: string | null = rawTimezone;
  let timezoneStatus: "valid" | "missing" | "invalid" = "valid";
  if (rawTimezone === null) {
    timezone = null;
    timezoneStatus = "missing";
  } else {
    try {
      Intl.DateTimeFormat("en-US", { timeZone: rawTimezone });
    } catch {
      timezoneStatus = "invalid";
    }
  }

  const businessHours = normalizePeriods(
    asRecord(field(record, "business_hours", "businessHours")),
    "periods",
    () => undefined,
  );

  return locationSchema.parse({
    addressLines,
    businessHours,
    currency,
    id,
    locale: stringField(record, "language_code", "languageCode") ?? "en-US",
    name,
    timezone,
    timezoneStatus,
  });
}

function minuteOfDay(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
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

function mergeIntervals(intervals: readonly WeeklyIntervalDto[]): WeeklyIntervalDto[] {
  const sorted = [...intervals].sort(
    (left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute,
  );
  const merged: WeeklyIntervalDto[] = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    // Keep touching intervals separate so overnight periods remain explicitly
    // split at their day boundary in the public weekly representation.
    if (previous !== undefined && interval.startMinute < previous.endMinute) {
      previous.endMinute = Math.max(previous.endMinute, interval.endMinute);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function intersectIntervals(
  left: readonly WeeklyIntervalDto[],
  right: readonly WeeklyIntervalDto[],
): WeeklyIntervalDto[] {
  const intersections: WeeklyIntervalDto[] = [];
  for (const leftInterval of left) {
    for (const rightInterval of right) {
      const startMinute = Math.max(leftInterval.startMinute, rightInterval.startMinute);
      const endMinute = Math.min(leftInterval.endMinute, rightInterval.endMinute);
      if (endMinute > startMinute) {
        intersections.push({ startMinute, endMinute });
      }
    }
  }
  return mergeIntervals(intersections);
}

function normalizePeriod(record: RawRecord): WeeklyIntervalDto[] | null {
  const day = stringField(record, "day_of_week", "dayOfWeek");
  const start = minuteOfDay(field(record, "start_local_time", "startLocalTime"));
  const end = minuteOfDay(field(record, "end_local_time", "endLocalTime"));
  if (day === null || start === null || end === null || DAY_START_MINUTES[day] === undefined || start === end) {
    return null;
  }

  const dayStart = DAY_START_MINUTES[day];
  if (end > start) {
    return [{ startMinute: dayStart + start, endMinute: dayStart + end }];
  }

  const nextDayStart = (dayStart + 1_440) % 10_080;
  const first = { startMinute: dayStart + start, endMinute: Math.min(dayStart + 1_440, 10_080) };
  const second = { startMinute: nextDayStart, endMinute: nextDayStart + end };
  return nextDayStart === 0
    ? [first, { startMinute: 0, endMinute: end }]
    : [first, second];
}

function normalizePeriods(
  parent: RawRecord | null,
  periodsField: string,
  resolvePeriod: (id: string) => RawRecord | undefined,
): WeeklyIntervalDto[] | null {
  if (parent === null) {
    return null;
  }
  const directPeriods = field(parent, periodsField);
  if (!Array.isArray(directPeriods)) {
    return null;
  }
  const intervals: WeeklyIntervalDto[] = [];
  for (const directPeriod of directPeriods) {
    const record = asRecord(directPeriod);
    const resolved = record ?? (typeof directPeriod === "string" ? resolvePeriod(directPeriod) : undefined);
    if (resolved === undefined || resolved === null) {
      return [];
    }
    const periodData = asRecord(field(resolved, "availability_period_data", "availabilityPeriodData")) ?? resolved;
    const normalized = normalizePeriod(periodData);
    if (normalized === null) {
      return [];
    }
    intervals.push(...normalized);
  }
  // An explicit empty business-hours list means the location configured no
  // open intervals, which is distinct from a missing business-hours object.
  return intervals.length === 0 ? [] : mergeIntervals(intervals);
}

function categorySeeds(
  index: ReadonlyMap<string, RawRecord>,
  addWarning: (code: string, message: string) => void,
): ReadonlyMap<string, CategorySeed> {
  const periods = new Map<string, RawRecord>();
  for (const [id, object] of index) {
    if (field(object, "type") === "AVAILABILITY_PERIOD" && !isDeleted(object)) {
      periods.set(id, object);
    }
  }
  const seeds = new Map<string, CategorySeed>();
  for (const [id, object] of index) {
    if (field(object, "type") !== "CATEGORY" || isDeleted(object)) {
      continue;
    }
    const data = asRecord(field(object, "category_data", "categoryData"));
    const name = data === null ? null : stringField(data, "name");
    if (name === null) {
      addWarning("MALFORMED_CATEGORY", "A category without a usable name was omitted.");
      continue;
    }
    const parent = data === null ? null : asRecord(field(data, "parent_category", "parentCategory"));
    const availabilityIds = data === null
      ? undefined
      : field(data, "availability_period_ids", "availabilityPeriodIds");
    let ownSchedule: readonly WeeklyIntervalDto[] | null = null;
    if (Array.isArray(availabilityIds)) {
      const intervals: WeeklyIntervalDto[] = [];
      let invalid = false;
      for (const rawPeriodId of availabilityIds) {
        const periodId = validId(rawPeriodId);
        const period = periodId === null ? undefined : periods.get(periodId);
        const normalized = period === undefined
          ? null
          : normalizePeriod(
              asRecord(field(period, "availability_period_data", "availabilityPeriodData")) ?? period,
            );
        if (normalized === null) {
          invalid = true;
          break;
        }
        intervals.push(...normalized);
      }
      if (invalid) {
        addWarning("INVALID_CATEGORY_SCHEDULE", "Invalid category schedule data fails closed.");
        ownSchedule = [];
      } else if (intervals.length > 0) {
        ownSchedule = mergeIntervals(intervals);
      }
    }
    seeds.set(id, {
      id,
      kind: stringField(data ?? {}, "category_type", "categoryType") === "MENU_CATEGORY" ? "menu" : "regular",
      name,
      ordinal: parent === null ? 0 : integerField(parent, "ordinal") ?? 0,
      ownSchedule,
      parentId: parent === null ? null : validId(field(parent, "id")),
    });
  }
  return seeds;
}

function selectedCategoryIds(
  itemData: RawRecord,
  categories: ReadonlyMap<string, CategorySeed>,
  addWarning: (code: string, message: string) => void,
): { readonly ids: readonly string[]; readonly ordinal: number } {
  const memberships = arrayField(itemData, "categories");
  const candidates = memberships.flatMap((membership) => {
    const record = asRecord(membership);
    const id = record === null ? null : validId(field(record, "id"));
    const category = id === null ? undefined : categories.get(id);
    if (id !== null && category === undefined) {
      addWarning("MISSING_ITEM_CATEGORY", "An item category reference was replaced with Other.");
    }
    return category === undefined
      ? []
      : [{ id: category.id, kind: category.kind, ordinal: integerField(record ?? {}, "ordinal") ?? 0 }];
  });
  const menu = candidates.filter((candidate) => candidate.kind === "menu");
  const selected = menu.length > 0 ? menu : candidates;
  if (selected.length === 0) {
    return { ids: [OTHER_CATEGORY_ID], ordinal: 0 };
  }
  const deduplicated = [...new Map(selected.map((candidate) => [candidate.id, candidate])).values()];
  return {
    ids: deduplicated.map((candidate) => candidate.id).sort(compareText),
    ordinal: Math.min(...deduplicated.map((candidate) => candidate.ordinal)),
  };
}

function imageUrl(
  ids: readonly unknown[],
  images: ReadonlyMap<string, RawRecord>,
  addWarning: (code: string, message: string) => void,
): string | null {
  for (const rawId of ids) {
    const id = validId(rawId);
    const image = id === null ? undefined : images.get(id);
    const data = image === undefined
      ? null
      : asRecord(field(image, "image_data", "imageData"));
    const url = data === null ? null : stringField(data, "url");
    if (url === null) {
      continue;
    }
    if (url.startsWith("https://")) {
      return url;
    }
    addWarning("INVALID_IMAGE_URL", "A non-HTTPS catalog image was omitted.");
  }
  return null;
}

function parseAmountMinor(value: unknown): string | null {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value).toString();
  }
  if (typeof value === "string" && /^(0|-?[1-9]\d*)$/.test(value)) {
    return value;
  }
  return null;
}

function money(
  raw: unknown,
  currency: string,
  addWarning: (code: string, message: string) => void,
): MoneyDto | null {
  const record = asRecord(raw);
  const amountMinor = record === null ? null : parseAmountMinor(field(record, "amount"));
  const rawCurrency = record === null ? null : stringField(record, "currency")?.toUpperCase() ?? null;
  if (amountMinor === null || rawCurrency === null) {
    addWarning("INVALID_MONEY", "A malformed money value was not exposed.");
    return null;
  }
  if (rawCurrency !== currency) {
    addWarning("CURRENCY_MISMATCH", "A cross-currency price was not exposed.");
    return null;
  }
  return { amountMinor, currency };
}

function locationOverride(record: RawRecord, locationId: string): RawRecord | null {
  for (const rawOverride of arrayField(record, "location_overrides", "locationOverrides")) {
    const override = asRecord(rawOverride);
    if (
      override !== null &&
      validId(field(override, "location_id", "locationId")) === locationId
    ) {
      return override;
    }
  }
  return null;
}

function validDate(value: unknown): string | null {
  const parsed = isoDateTimeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function inventoryByVariation(
  inventory: readonly unknown[],
  locationId: string,
): ReadonlyMap<string, InventoryObservation> {
  const observations = new Map<string, InventoryObservation>();
  for (const rawCount of inventory) {
    const record = asRecord(rawCount);
    if (
      record === null ||
      validId(field(record, "location_id", "locationId")) !== locationId ||
      stringField(record, "state") !== "IN_STOCK"
    ) {
      continue;
    }
    const id = validId(field(record, "catalog_object_id", "catalogObjectId"));
    const quantity = stringField(record, "quantity");
    if (id === null || quantity === null) {
      continue;
    }
    const next = { calculatedAt: validDate(field(record, "calculated_at", "calculatedAt")), quantity };
    const existing = observations.get(id);
    if (
      existing === undefined ||
      (next.calculatedAt !== null && (existing.calculatedAt === null || next.calculatedAt > existing.calculatedAt))
    ) {
      observations.set(id, next);
    }
  }
  return observations;
}

function normalizeVariations(
  itemData: RawRecord,
  itemImage: string | null,
  location: MenuSnapshotDto["location"],
  inventory: ReadonlyMap<string, InventoryObservation>,
  hasInventory: boolean,
  now: Date,
  seenVariationIds: Set<string>,
  images: ReadonlyMap<string, RawRecord>,
  addWarning: (code: string, message: string) => void,
): MenuItemDto["variations"] {
  const variations: MenuItemDto["variations"] = [];
  for (const rawVariation of arrayField(itemData, "variations")) {
    const variation = asRecord(rawVariation);
    const id = variation === null ? null : validId(field(variation, "id"));
    const data = variation === null
      ? null
      : asRecord(field(variation, "item_variation_data", "itemVariationData"));
    if (variation === null || id === null || data === null) {
      addWarning("MALFORMED_VARIATION", "A malformed item variation was omitted.");
      continue;
    }
    if (!presenceAtLocation(variation, location.id)) {
      continue;
    }
    if (seenVariationIds.has(id)) {
      addWarning("DUPLICATE_VARIATION_ID", "Duplicate variation IDs were omitted.");
      continue;
    }
    seenVariationIds.add(id);
    const override = locationOverride(data, location.id);
    const pricingType = stringField(override ?? {}, "pricing_type", "pricingType") ??
      stringField(data, "pricing_type", "pricingType");
    const rawPrice = field(override ?? {}, "price_money", "priceMoney") ??
      field(data, "price_money", "priceMoney");
    let pricingStatus: "fixed" | "variable" | "invalid" = "invalid";
    let price: MoneyDto | null = null;
    if (pricingType === "FIXED_PRICING") {
      price = money(rawPrice, location.currency, addWarning);
      pricingStatus = price === null ? "invalid" : "fixed";
    } else if (pricingType === "VARIABLE_PRICING") {
      pricingStatus = "variable";
    } else {
      addWarning("UNSUPPORTED_PRICING", "An unsupported variation pricing model remains browse-only.");
    }
    const observation = inventory.get(id);
    if (
      observation !== undefined &&
      !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(observation.quantity)
    ) {
      addWarning("INVALID_INVENTORY_QUANTITY", "A malformed inventory quantity was treated as unknown.");
    }
    const inventoryResolution = resolveInventoryState({
      calculatedAt: observation?.calculatedAt,
      globalTrackInventory: booleanField(data, "track_inventory", "trackInventory"),
      inventoryAvailable: hasInventory,
      locationSoldOut: booleanField(override ?? {}, "sold_out", "soldOut"),
      locationTrackInventory: booleanField(override ?? {}, "track_inventory", "trackInventory"),
      now,
      quantity: observation?.quantity,
      soldOutValidUntil: validDate(
        field(override ?? {}, "sold_out_valid_until", "soldOutValidUntil"),
      ),
    });
    variations.push({
      id,
      imageUrl: imageUrl(arrayField(data, "image_ids", "imageIds"), images, addWarning) ?? itemImage,
      inventoryState: inventoryResolution.inventoryState,
      inventoryUpdatedAt: inventoryResolution.inventoryUpdatedAt,
      name: stringField(data, "name") ?? "Default",
      ordinal: integerField(data, "ordinal") ?? 0,
      price,
      pricingStatus,
      sellable: booleanField(data, "sellable") !== false,
      soldOutUntil: inventoryResolution.soldOutUntil,
    });
  }
  return sortByOrdinalNameAndId(variations);
}

function onlineVisible(record: RawRecord): boolean {
  return booleanField(record, "online_visibility", "onlineVisibility") !== false;
}

function effectiveModifierPrice(
  modifierData: RawRecord,
  itemOverride: RawRecord | null,
  locationId: string,
  currency: string,
  addWarning: (code: string, message: string) => void,
): MoneyDto | null {
  const rawPrice = field(itemOverride ?? {}, "price_money", "priceMoney") ??
    field(locationOverride(modifierData, locationId) ?? {}, "price_money", "priceMoney") ??
    field(modifierData, "price_money", "priceMoney");
  if (rawPrice === undefined) {
    return { amountMinor: "0", currency };
  }
  return money(rawPrice, currency, addWarning);
}

function normalizeModifierGroups(
  itemData: RawRecord,
  modifierLists: ReadonlyMap<string, RawRecord>,
  location: MenuSnapshotDto["location"],
  addWarning: (code: string, message: string) => void,
): Pick<PreparedItem, "modifierConfigurationError" | "modifierGroups"> {
  const groups: MenuItemDto["modifierGroups"] = [];
  let configurationError: string | null = null;
  const groupIds = new Set<string>();
  const markInvalid = (message: string): void => {
    configurationError ??= message;
  };

  for (const rawInfo of arrayField(itemData, "modifier_list_info", "modifierListInfo")) {
    const info = asRecord(rawInfo);
    const listId = info === null ? null : validId(field(info, "modifier_list_id", "modifierListId"));
    const list = listId === null ? undefined : modifierLists.get(listId);
    if (info === null || listId === null || list === undefined || !presenceAtLocation(list, location.id)) {
      addWarning("MISSING_MODIFIER_LIST", "A referenced modifier list is unavailable at this location.");
      markInvalid("A required modifier configuration is unavailable.");
      continue;
    }
    if (groupIds.has(listId)) {
      addWarning("DUPLICATE_MODIFIER_LIST", "Duplicate modifier-list references were omitted.");
      markInvalid("Duplicate modifier configuration is unavailable.");
      continue;
    }
    groupIds.add(listId);
    if (booleanField(info, "enabled") === false) {
      continue;
    }
    const data = asRecord(field(list, "modifier_list_data", "modifierListData"));
    const name = data === null ? null : stringField(data, "name");
    if (data === null || name === null || !onlineVisible(data)) {
      continue;
    }
    const type = stringField(data, "modifier_type", "modifierType");
    const ordinal = integerField(info, "ordinal") ?? integerField(data, "ordinal") ?? 0;
    if (type === "TEXT") {
      const maximumCodePoints = integerField(data, "max_length", "maxLength");
      if (maximumCodePoints === null || maximumCodePoints === 0) {
        addWarning("INVALID_TEXT_MODIFIER", "An invalid text modifier configuration was disabled.");
        markInvalid("A text modifier configuration is invalid.");
        continue;
      }
      groups.push({
        id: listId,
        maximumCodePoints,
        name,
        ordinal,
        required: booleanField(data, "text_required", "textRequired") === true,
        type: "text",
      });
      continue;
    }
    if (type !== "LIST") {
      addWarning("UNSUPPORTED_MODIFIER_TYPE", "An unsupported modifier type was disabled.");
      markInvalid("A modifier configuration is unsupported.");
      continue;
    }
    const overrides = new Map<string, RawRecord>();
    for (const rawOverride of arrayField(info, "modifier_overrides", "modifierOverrides")) {
      const override = asRecord(rawOverride);
      const id = override === null ? null : validId(field(override, "modifier_id", "modifierId"));
      if (override !== null && id !== null) {
        overrides.set(id, override);
      }
    }
    const options: Exclude<MenuItemDto["modifierGroups"][number], { type: "text" }>["options"] = [];
    const optionIds = new Set<string>();
    for (const rawModifier of arrayField(data, "modifiers")) {
      const modifier = asRecord(rawModifier);
      const optionId = modifier === null ? null : validId(field(modifier, "id"));
      const modifierData = modifier === null
        ? null
        : asRecord(field(modifier, "modifier_data", "modifierData"));
      const override = optionId === null ? null : overrides.get(optionId) ?? null;
      if (
        optionId === null ||
        modifierData === null ||
        optionIds.has(optionId) ||
        !onlineVisible(modifierData) ||
        booleanField(override ?? {}, "enabled") === false
      ) {
        continue;
      }
      const price = effectiveModifierPrice(
        modifierData,
        override,
        location.id,
        location.currency,
        addWarning,
      );
      if (price === null) {
        markInvalid("A modifier price has an unsupported currency.");
        continue;
      }
      optionIds.add(optionId);
      options.push({
        defaultSelected: booleanField(override ?? {}, "on_by_default", "onByDefault") ??
          booleanField(modifierData, "on_by_default", "onByDefault") === true,
        id: optionId,
        name: stringField(modifierData, "name") ?? "Option",
        ordinal: integerField(override ?? {}, "ordinal") ?? integerField(modifierData, "ordinal") ?? 0,
        price,
      });
    }
    const minimumSelections = integerField(info, "min_selected_modifiers", "minSelectedModifiers") ??
      integerField(data, "min_selected_modifiers", "minSelectedModifiers") ?? 0;
    const maximumSelections = integerField(info, "max_selected_modifiers", "maxSelectedModifiers") ??
      integerField(data, "max_selected_modifiers", "maxSelectedModifiers") ?? 0;
    const allowQuantities = booleanField(data, "allow_quantities", "allowQuantities") === true;
    if (
      options.length === 0 ||
      (maximumSelections !== 0 && maximumSelections < minimumSelections) ||
      (!allowQuantities && minimumSelections > options.length)
    ) {
      addWarning("INVALID_MODIFIER_LIMITS", "A required modifier configuration was disabled.");
      markInvalid("A required modifier configuration is invalid.");
      continue;
    }
    groups.push({
      allowQuantities,
      id: listId,
      maximumSelections,
      minimumSelections,
      name,
      options: sortByOrdinalNameAndId(options),
      ordinal,
      type: "list",
    });
  }

  return {
    modifierConfigurationError: configurationError,
    modifierGroups: sortByOrdinalNameAndId(groups),
  };
}

function effectiveCategoryModel(
  selectedLeaves: ReadonlySet<string>,
  seeds: ReadonlyMap<string, CategorySeed>,
  addWarning: (code: string, message: string) => void,
): { readonly categories: readonly CategoryDto[]; readonly schedules: ReadonlyMap<string, readonly WeeklyIntervalDto[] | null> } {
  const selected = new Set<string>();
  const brokenParents = new Set<string>();
  for (const leaf of selectedLeaves) {
    if (leaf === OTHER_CATEGORY_ID) {
      continue;
    }
    const chain: string[] = [];
    const positions = new Map<string, number>();
    let current: string | null = leaf;
    while (current !== null) {
      const seed = seeds.get(current);
      if (seed === undefined) {
        addWarning("MISSING_CATEGORY_PARENT", "A missing category parent was removed from the menu hierarchy.");
        break;
      }
      const position = positions.get(current);
      if (position !== undefined) {
        addWarning("CATEGORY_CYCLE", "A category cycle was broken safely.");
        for (const id of chain.slice(position)) {
          brokenParents.add(id);
        }
        break;
      }
      positions.set(current, chain.length);
      chain.push(current);
      selected.add(current);
      current = seed.parentId;
    }
  }
  if (selectedLeaves.has(OTHER_CATEGORY_ID)) {
    selected.add(OTHER_CATEGORY_ID);
  }

  const schedules = new Map<string, readonly WeeklyIntervalDto[] | null>();
  const calculating = new Set<string>();
  const resolveSchedule = (id: string): readonly WeeklyIntervalDto[] | null => {
    const existing = schedules.get(id);
    if (existing !== undefined || schedules.has(id)) {
      return existing ?? null;
    }
    const seed = seeds.get(id);
    if (seed === undefined || brokenParents.has(id) || seed.parentId === null || !selected.has(seed.parentId)) {
      const result = seed?.ownSchedule ?? null;
      schedules.set(id, result);
      return result;
    }
    if (calculating.has(id)) {
      return [];
    }
    calculating.add(id);
    const parent = resolveSchedule(seed.parentId);
    calculating.delete(id);
    const result = parent === null
      ? seed.ownSchedule
      : seed.ownSchedule === null
        ? parent
        : intersectIntervals(parent, seed.ownSchedule);
    schedules.set(id, result);
    return result;
  };

  const categories: CategoryDto[] = [];
  for (const id of selected) {
    if (id === OTHER_CATEGORY_ID) {
      categories.push(OTHER_CATEGORY);
      schedules.set(id, null);
      continue;
    }
    const seed = seeds.get(id);
    if (seed === undefined) {
      continue;
    }
    const parentId = !brokenParents.has(id) && seed.parentId !== null && selected.has(seed.parentId)
      ? seed.parentId
      : null;
    const schedule = resolveSchedule(id);
    categories.push({
      id,
      kind: seed.kind,
      name: seed.name,
      ordinal: seed.ordinal,
      parentId,
      scheduleWindows: schedule === null ? null : [...schedule],
    });
  }
  return { categories: sortByOrdinalNameAndId(categories), schedules };
}

function itemSchedule(
  categoryIds: readonly string[],
  schedules: ReadonlyMap<string, readonly WeeklyIntervalDto[] | null>,
): readonly WeeklyIntervalDto[] | null {
  const windows = categoryIds.map((id) => schedules.get(id) ?? null);
  if (windows.some((window) => window === null)) {
    return null;
  }
  return mergeIntervals(windows.flatMap((window) => window ?? []));
}

function catalogUpdatedAt(index: ReadonlyMap<string, RawRecord>): string | null {
  let latest: string | null = null;
  for (const object of index.values()) {
    const updatedAt = validDate(field(object, "updated_at", "updatedAt"));
    if (updatedAt !== null && (latest === null || updatedAt > latest)) {
      latest = updatedAt;
    }
  }
  return latest;
}

/**
 * Normalize raw Square objects into a location-scoped, JSON-safe public menu.
 * All decisions happen server-side; raw SDK objects and bigint values never
 * escape this boundary.
 */
export function normalizeMenu(input: MenuNormalizationInput): MenuNormalizationResult {
  const warnings = warningCollector();
  const location = normalizeLocation(input.location);
  const now = input.generatedAt ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new MenuNormalizationError("The menu generation timestamp is invalid.");
  }
  const index = indexCatalog(input.catalog, warnings.add);
  const categories = categorySeeds(index.byId, warnings.add);
  const images = new Map<string, RawRecord>();
  const modifiers = new Map<string, RawRecord>();
  for (const [id, object] of index.byId) {
    if (isDeleted(object)) {
      continue;
    }
    if (field(object, "type") === "IMAGE") {
      images.set(id, object);
    }
    if (field(object, "type") === "MODIFIER_LIST") {
      modifiers.set(id, object);
    }
  }
  const hasInventory = input.inventory !== undefined;
  const inventory = inventoryByVariation(input.inventory ?? [], location.id);
  const seenVariationIds = new Set<string>();
  const prepared: PreparedItem[] = [];
  const selectedLeaves = new Set<string>();
  const seenItemIds = new Set<string>();

  for (const [id, object] of index.byId) {
    if (field(object, "type") !== "ITEM" || isDeleted(object) || !presenceAtLocation(object, location.id)) {
      continue;
    }
    const data = asRecord(field(object, "item_data", "itemData"));
    if (data === null || booleanField(data, "is_archived", "isArchived") === true) {
      continue;
    }
    if (seenItemIds.has(id)) {
      continue;
    }
    seenItemIds.add(id);
    const categorySelection = selectedCategoryIds(data, categories, warnings.add);
    const itemImage = imageUrl(arrayField(data, "image_ids", "imageIds"), images, warnings.add);
    const variations = normalizeVariations(
      data,
      itemImage,
      location,
      inventory,
      hasInventory,
      now,
      seenVariationIds,
      images,
      warnings.add,
    );
    if (variations.length === 0) {
      addItemWarning(warnings.add);
      continue;
    }
    const normalizedModifiers = normalizeModifierGroups(data, modifiers, location, warnings.add);
    for (const categoryId of categorySelection.ids) {
      selectedLeaves.add(categoryId);
    }
    prepared.push({
      categoryIds: categorySelection.ids,
      description: stringField(data, "description_plaintext", "descriptionPlaintext") ?? "",
      id,
      imageUrl: itemImage,
      modifierConfigurationError: normalizedModifiers.modifierConfigurationError,
      modifierGroups: normalizedModifiers.modifierGroups,
      name: stringField(data, "buyer_facing_name", "buyerFacingName") ?? stringField(data, "name") ?? "Unnamed item",
      ordinal: categorySelection.ordinal,
      variations,
    });
  }

  const categoryModel = effectiveCategoryModel(selectedLeaves, categories, warnings.add);
  const items = sortByOrdinalNameAndId(
    prepared.map((item) => ({
      ...item,
      scheduleWindows: itemSchedule(item.categoryIds, categoryModel.schedules),
    })),
  );
  const snapshot = menuSnapshotSchema.parse({
    catalogUpdatedAt: catalogUpdatedAt(index.byId),
    categories: categoryModel.categories,
    generatedAt: now.toISOString(),
    inventoryStatus: input.inventoryStatus ?? (hasInventory ? "fresh" : "unavailable"),
    items,
    location,
    schemaVersion: PUBLIC_SCHEMA_VERSION,
  });

  return { snapshot, warnings: warnings.values() };
}

function addItemWarning(addWarning: (code: string, message: string) => void): void {
  addWarning("ITEM_WITHOUT_LOCATION_VARIATION", "An item without a location-visible variation was omitted.");
}
