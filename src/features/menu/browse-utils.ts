import type {
  ApiMetaDto,
  CategoryDto,
  MenuItemDto,
  MenuSnapshotDto,
  MoneyDto,
} from "@/shared/contracts";
import type { ItemOrderability, OrderabilityReason } from "@/features/menu/availability";

export function normalizeSearch(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function itemMatchesSearch(
  item: MenuItemDto,
  categories: readonly CategoryDto[],
  search: string,
): boolean {
  const tokens = normalizeSearch(search);
  if (tokens.length === 0) {
    return true;
  }
  const categoryNames = categories
    .filter((category) => item.categoryIds.includes(category.id))
    .map((category) => category.name);
  const haystack = normalizeSearch(
    [
      item.name,
      item.description,
      ...categoryNames,
      ...item.variations.map((variation) => variation.name),
    ].join(" "),
  ).join(" ");
  return tokens.every((token) => haystack.includes(token));
}

export function filterMenuItems(
  snapshot: MenuSnapshotDto,
  categoryId: string | null,
  search: string,
): MenuItemDto[] {
  return snapshot.items.filter(
    (item) =>
      (categoryId === null || item.categoryIds.includes(categoryId)) &&
      itemMatchesSearch(item, snapshot.categories, search),
  );
}

export function formatMoney(money: MoneyDto, locale: string): string {
  const fractionDigits = new Intl.NumberFormat(locale, {
    currency: money.currency,
    style: "currency",
  }).resolvedOptions().maximumFractionDigits ?? 2;
  const absoluteMinor = money.amountMinor.startsWith("-")
    ? money.amountMinor.slice(1)
    : money.amountMinor;
  const divisor = BigInt(10) ** BigInt(fractionDigits);
  const absolute = BigInt(absoluteMinor);
  const whole = absolute / divisor;
  const fraction = fractionDigits === 0
    ? ""
    : (absolute % divisor).toString().padStart(fractionDigits, "0");
  const currencyParts = new Intl.NumberFormat(locale, {
    currency: money.currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    style: "currency",
  }).formatToParts(money.amountMinor.startsWith("-") ? -0 : 0);
  const groupedWhole = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(whole);
  return currencyParts
    .map((part) => {
      if (part.type === "integer") {
        return groupedWhole;
      }
      if (part.type === "fraction") {
        return fraction;
      }
      return part.value;
    })
    .join("");
}

export function itemPriceLabel(item: MenuItemDto, locale: string): string {
  const fixedPrices = item.variations
    .filter((variation) => variation.pricingStatus === "fixed" && variation.price !== null)
    .flatMap((variation) => variation.price === null ? [] : [variation.price]);
  if (fixedPrices.length === 0) {
    return "Price varies";
  }
  const least = fixedPrices.reduce((current, price) =>
    BigInt(price.amountMinor) < BigInt(current.amountMinor) ? price : current,
  );
  const formatted = formatMoney(least, locale);
  return fixedPrices.length > 1 ? `From ${formatted}` : formatted;
}

export function reasonLabel(
  reason: OrderabilityReason,
  nextOpening: string | null,
  locale: string,
): string {
  if (reason === "orderable") {
    return "Available now";
  }
  if (reason === "offline_or_stale") {
    return "Ordering is unavailable while this menu is stale.";
  }
  if (reason === "invalid_location_timezone") {
    return "Ordering is unavailable until this location’s time zone is configured.";
  }
  if (reason === "location_closed") {
    return nextOpening === null
      ? "This location is currently closed."
      : `Opens ${new Intl.DateTimeFormat(locale, {
          weekday: "long",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(nextOpening))}.`;
  }
  if (reason === "category_schedule_closed") {
    return nextOpening === null
      ? "This item is not scheduled right now."
      : `Available ${new Intl.DateTimeFormat(locale, {
          weekday: "long",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(nextOpening))}.`;
  }
  if (reason === "variation_not_sellable") {
    return "This option is not available for ordering.";
  }
  if (reason === "sold_out") {
    return "Sold out.";
  }
  return "This item’s modifier setup needs attention.";
}

export function sourceAgeLabel(meta: ApiMetaDto, now: Date): string {
  const ageMinutes = Math.max(0, Math.floor((now.getTime() - Date.parse(meta.fetchedAt)) / 60_000));
  if (ageMinutes < 1) {
    return meta.source === "upstream" ? "Updated just now" : "Cached just now";
  }
  return `${meta.source === "upstream" ? "Updated" : "Cached"} ${ageMinutes}m ago`;
}

export function itemAvailability(
  availability: readonly ItemOrderability[],
  itemId: string,
): ItemOrderability | undefined {
  return availability.find((item) => item.id === itemId);
}
