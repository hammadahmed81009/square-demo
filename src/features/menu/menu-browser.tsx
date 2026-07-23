"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import type { LocationDto, MenuItemDto } from "@/shared/contracts";
import {
  evaluateMenuOrderability,
  nextMinuteBoundary,
  type ItemOrderability,
} from "@/features/menu/availability";
import { CartPanel, ItemConfigurator } from "@/features/cart/cart-ui";
import { useLocationCart } from "@/features/cart/cart-store";

import {
  filterMenuItems,
  itemAvailability,
  itemPriceLabel,
  reasonLabel,
  sourceAgeLabel,
} from "./browse-utils";
import {
  ApiClientError,
  LAST_LOCATION_KEY,
  useLocationsBootstrap,
  useMenuData,
  useOnlineStatus,
  type DataOrigin,
  type MenuResponse,
} from "./use-menu-data";

function MenuImage({ alt, src }: { readonly alt: string; readonly src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (src === null || failed) {
    return (
      <div
        aria-label={`${alt} image unavailable`}
        className="flex aspect-[4/3] items-center justify-center bg-paper-deep font-[family-name:var(--font-display)] text-sm font-semibold tracking-wide text-ink-soft"
        role="img"
      >
        Per Diem
      </div>
    );
  }
  return (
    <Image
      alt={alt}
      className="aspect-[4/3] w-full object-cover"
      height={360}
      onError={() => setFailed(true)}
      src={src}
      width={480}
    />
  );
}

function LoadingState() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8" id="main-content">
      <div className="h-10 w-48 skeleton rounded-lg" />
      <div className="mt-3 h-4 w-32 skeleton rounded" />
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {["one", "two", "three"].map((key) => (
          <div className="overflow-hidden rounded-[1.25rem] border border-line/70 bg-surface" key={key}>
            <div className="aspect-[4/3] skeleton" />
            <div className="space-y-3 p-4">
              <div className="h-5 w-2/3 skeleton rounded" />
              <div className="h-4 w-full skeleton rounded" />
              <div className="h-4 w-1/2 skeleton rounded" />
            </div>
          </div>
        ))}
      </div>
      <p className="sr-only">Loading the location menu.</p>
    </main>
  );
}

function ErrorState({ error, onRetry }: { readonly error: ApiClientError; readonly onRetry: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-10 sm:px-8" id="main-content">
      <section aria-live="assertive" className="animate-rise rounded-[1.5rem] border border-danger/20 bg-danger-soft p-7 shadow-[var(--shadow)]">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-danger">Menu unavailable</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-ink">
          We could not load this menu.
        </h1>
        <p className="mt-3 text-ink-soft">{error.message}</p>
        {error.retryable ? (
          <button
            className="mt-6 min-h-11 rounded-xl bg-ink px-5 py-2.5 font-semibold text-white transition hover:bg-ink-soft"
            onClick={onRetry}
            type="button"
          >
            Retry
          </button>
        ) : null}
      </section>
    </main>
  );
}

function LocationSelector({
  activeId,
  locations,
  onLocationChange,
}: {
  readonly activeId: string;
  readonly locations: readonly LocationDto[];
  readonly onLocationChange: (locationId: string) => void;
}) {
  return (
    <label className="block text-sm font-semibold text-ink-soft">
      Location
      <select
        aria-label="Choose location"
        className="mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-base text-ink shadow-sm transition hover:border-ink/30"
        onChange={(event) => onLocationChange(event.target.value)}
        value={activeId}
      >
        {locations.map((location) => (
          <option key={location.id} value={location.id}>{location.name}</option>
        ))}
      </select>
    </label>
  );
}

function AvailabilityBadge({ availability, locale }: { readonly availability: ItemOrderability | undefined; readonly locale: string }) {
  if (availability === undefined) {
    return null;
  }
  const available = availability.reason === "orderable";
  return (
    <p className={`mt-3 text-sm font-medium ${available ? "text-ok" : "text-warn"}`}>
      {reasonLabel(availability.reason, availability.nextOpening, locale)}
    </p>
  );
}

function StatusBanners({
  menu,
  online,
  origin,
  refreshing,
}: {
  readonly menu: MenuResponse;
  readonly online: boolean;
  readonly origin: DataOrigin;
  readonly refreshing: boolean;
}) {
  const banners: { key: string; tone: "neutral" | "warn" | "info"; body: ReactNode; label?: string }[] = [];

  if (!online) {
    banners.push({
      key: "offline",
      tone: "neutral",
      body: "You are offline. Browsing and search still work from the saved menu, but cart changes stay disabled until you reconnect and refresh.",
    });
  }
  if (online && origin === "browser-cache") {
    banners.push({
      key: "browser-cache",
      tone: "warn",
      body: (
        <>
          Showing a saved menu snapshot{refreshing ? " while refreshing…" : "."} Inventory may be outdated, and ordering controls stay disabled until a fresh response arrives.
        </>
      ),
    });
  }
  if (menu.meta.source === "server-stale") {
    banners.push({
      key: "server-stale",
      tone: "warn",
      body: "This is a server-stale menu snapshot. Browsing is available, but ordering controls are disabled until it refreshes.",
    });
  }

  const toneClass = {
    neutral: "border-line bg-paper-deep text-ink",
    warn: "border-warn/25 bg-warn-soft text-warn",
    info: "border-ok/20 bg-ok-soft text-ok",
  } as const;

  return (
    <div className="mt-5 grid gap-3">
      {banners.map((banner) => (
        <p className={`animate-fade rounded-2xl border px-4 py-3.5 text-sm leading-6 ${toneClass[banner.tone]}`} key={banner.key} role="status">
          {banner.body}
        </p>
      ))}
      {menu.meta.warnings.length > 0 ? (
        <section aria-label="Menu notices" className="animate-fade rounded-2xl border border-ok/20 bg-ok-soft px-4 py-3.5">
          <p className="font-semibold text-ink">Menu notices</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
            {menu.meta.warnings.map((warning) => (
              <li key={`${warning.code}:${warning.message}`}>{warning.message}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ItemCard({
  availability,
  item,
  locationId,
  locale,
  index,
}: {
  readonly availability: ItemOrderability | undefined;
  readonly item: MenuItemDto;
  readonly locationId: string;
  readonly locale: string;
  readonly index: number;
}) {
  const available = availability?.reason === "orderable";
  return (
    <article
      className="group animate-rise overflow-hidden rounded-[1.25rem] border border-line/80 bg-surface transition duration-300 hover:-translate-y-0.5 hover:border-ink/20 hover:shadow-[var(--shadow)]"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <Link aria-label={`View ${item.name} details`} className="block focus-visible:outline-offset-[-2px]" href={`/locations/${locationId}/items/${item.id}`}>
        <div className="overflow-hidden">
          <div className="transition duration-500 group-hover:scale-[1.03]">
            <MenuImage alt={item.name} src={item.imageUrl} />
          </div>
        </div>
        <div className="px-4 pb-5 pt-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-ink">{item.name}</h3>
            <span className="shrink-0 pt-1 text-sm font-semibold text-ink-soft">{itemPriceLabel(item, locale)}</span>
          </div>
          {item.description.length > 0 ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{item.description}</p> : null}
          <AvailabilityBadge availability={availability} locale={locale} />
          <span className={`mt-4 inline-flex min-h-10 items-center text-sm font-semibold ${available ? "text-accent-deep" : "text-muted"}`}>
            View details
            <span aria-hidden className="ml-1 transition group-hover:translate-x-0.5">→</span>
          </span>
        </div>
      </Link>
    </article>
  );
}

function EmptyState({ title, body, action }: { readonly title: string; readonly body: string; readonly action?: ReactNode }) {
  return (
    <div className="animate-fade rounded-[1.5rem] border border-dashed border-line bg-surface/80 px-6 py-12 text-center">
      <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-3 max-w-md text-ink-soft">{body}</p>
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}

function DetailView({
  availability,
  canMutate,
  cart,
  item,
  locale,
  locationId,
  menu,
  online,
  origin,
  refreshing,
}: {
  readonly availability: ItemOrderability | undefined;
  readonly canMutate: boolean;
  readonly cart: ReturnType<typeof useLocationCart>;
  readonly item: MenuItemDto;
  readonly locale: string;
  readonly locationId: string;
  readonly menu: MenuResponse;
  readonly online: boolean;
  readonly origin: DataOrigin;
  readonly refreshing: boolean;
}) {
  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8" id="main-content">
      <Link className="inline-flex min-h-10 items-center text-sm font-semibold text-accent-deep underline-offset-4 hover:underline" href={`/locations/${locationId}`}>
        ← Back to menu
      </Link>
      <StatusBanners menu={menu} online={online} origin={origin} refreshing={refreshing} />
      <article className="animate-rise mt-5 grid gap-8 overflow-hidden rounded-[1.5rem] border border-line bg-surface md:grid-cols-2">
        <MenuImage alt={item.name} src={item.imageUrl} />
        <div className="flex flex-col justify-center p-5 md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-deep">Item details</p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-ink">{item.name}</h1>
          <p className="mt-3 text-lg font-semibold text-ink-soft">{itemPriceLabel(item, locale)}</p>
          {item.description.length > 0 ? <p className="mt-4 leading-7 text-ink-soft">{item.description}</p> : null}
          <AvailabilityBadge availability={availability} locale={locale} />
        </div>
      </article>
      <section aria-labelledby="variation-heading" className="mt-8">
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink" id="variation-heading">Options</h2>
        <ul className="mt-3 grid gap-3">
          {item.variations.map((variation) => {
            const state = availability?.variations.find((candidate) => candidate.id === variation.id);
            return (
              <li className="rounded-2xl border border-line bg-surface px-4 py-3.5" key={variation.id}>
                <div className="flex items-center justify-between gap-4">
                  <span className="font-semibold text-ink">{variation.name}</span>
                  <span className="text-sm font-semibold text-ink-soft">
                    {variation.price === null ? "Price varies" : itemPriceLabel({ ...item, variations: [variation] }, locale)}
                  </span>
                </div>
                {state === undefined || state.reason === "orderable" ? null : (
                  <p className="mt-2 text-sm text-warn">{reasonLabel(state.reason, state.nextOpening, locale)}</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {item.modifierGroups.length > 0 ? (
        <section aria-labelledby="modifier-heading" className="mt-8">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink" id="modifier-heading">Customizations</h2>
          <ul className="mt-3 grid gap-3">
            {item.modifierGroups.map((group) => (
              <li className="rounded-2xl border border-line bg-surface px-4 py-3.5" key={group.id}>
                <p className="font-semibold text-ink">{group.name}</p>
                <p className="mt-1 text-sm text-muted">
                  {group.type === "text"
                    ? `${group.required ? "Required" : "Optional"} text, up to ${group.maximumCodePoints} characters.`
                    : `${group.minimumSelections > 0 ? "Required" : "Optional"}; choose up to ${group.maximumSelections || "any"}.`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ItemConfigurator availability={availability} canMutate={canMutate} currency={cart.cart.currency} item={item} locale={locale} onAdd={cart.add} />
      <CartPanel canMutate={canMutate} controls={cart} locale={locale} notices={cart.notices} />
    </main>
  );
}

function NotFoundState({ locationId, itemId }: { readonly locationId: string; readonly itemId?: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-10 sm:px-8" id="main-content">
      <section className="animate-rise rounded-[1.5rem] border border-line bg-surface p-7 shadow-[var(--shadow)]">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Not found</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold text-ink">
          {itemId === undefined ? "This location is unavailable." : "This item is unavailable."}
        </h1>
        <p className="mt-3 text-ink-soft">Choose an active location to continue browsing the menu.</p>
        <Link
          className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-ink px-5 py-2.5 font-semibold text-white transition hover:bg-ink-soft"
          href={itemId === undefined ? "/" : `/locations/${locationId}`}
        >
          Continue
        </Link>
      </section>
    </main>
  );
}

function MenuContent({
  menu,
  locations,
  locationId,
  itemId,
  now,
  online,
  origin,
  refreshing,
}: {
  readonly itemId?: string;
  readonly locationId: string;
  readonly locations: readonly LocationDto[];
  readonly menu: MenuResponse;
  readonly now: Date;
  readonly online: boolean;
  readonly origin: DataOrigin;
  readonly refreshing: boolean;
}) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [pendingLocationId, setPendingLocationId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const resultsId = useId();
  const isSnapshotFresh = origin === "network" && menu.meta.source !== "server-stale";
  const availability = useMemo(
    () => evaluateMenuOrderability({
      isOnline: online,
      isSnapshotFresh,
      now,
      snapshot: menu.data,
    }).items,
    [isSnapshotFresh, menu.data, now, online],
  );
  const filteredItems = useMemo(
    () => filterMenuItems(menu.data, categoryId, search),
    [categoryId, menu.data, search],
  );
  const cart = useLocationCart(locationId, menu.data.location.currency, menu.data, availability);
  const canMutate = online && isSnapshotFresh && cart.hydrated;
  const address = menu.data.location.addressLines.filter(Boolean).join(" · ");

  useEffect(() => {
    headingRef.current?.focus();
  }, [itemId, locationId]);

  useEffect(() => {
    if (pendingLocationId !== null) {
      cancelRef.current?.focus();
    }
  }, [pendingLocationId]);

  if (itemId !== undefined) {
    const item = menu.data.items.find((candidate) => candidate.id === itemId);
    return item === undefined
      ? <NotFoundState itemId={itemId} locationId={locationId} />
      : (
        <DetailView
          availability={itemAvailability(availability, item.id)}
          canMutate={canMutate}
          cart={cart}
          item={item}
          locale={menu.data.location.locale}
          locationId={locationId}
          menu={menu}
          online={online}
          origin={origin}
          refreshing={refreshing}
        />
      );
  }

  function requestLocationChange(nextLocationId: string) {
    if (nextLocationId === locationId) {
      return;
    }
    if (cart.cart.lines.length > 0) {
      setPendingLocationId(nextLocationId);
      return;
    }
    router.push(`/locations/${nextLocationId}`);
  }

  function confirmLocationChange() {
    if (pendingLocationId === null) {
      return;
    }
    cart.clear();
    router.push(`/locations/${pendingLocationId}`);
  }

  const grouped = search.trim().length > 0 || categoryId !== null
    ? [{ id: categoryId ?? "search", name: categoryId === null ? "Search results" : menu.data.categories.find((category) => category.id === categoryId)?.name ?? "Category", items: filteredItems }]
    : (() => {
        const assignedItemIds = new Set<string>();
        return menu.data.categories
          .map((category) => ({
            id: category.id,
            name: category.name,
            items: filteredItems.filter((item) => {
              if (!item.categoryIds.includes(category.id) || assignedItemIds.has(item.id)) {
                return false;
              }
              assignedItemIds.add(item.id);
              return true;
            }),
          }))
          .filter((group) => group.items.length > 0);
      })();

  return (
    <>
      <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8" id="main-content">
        <header className="animate-fade flex flex-col gap-6 border-b border-line/80 pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-[0.18em] text-accent-deep uppercase">
              Per Diem
            </p>
            <h1
              className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-ink sm:text-5xl"
              ref={headingRef}
              tabIndex={-1}
            >
              {menu.data.location.name}
            </h1>
            {address.length > 0 ? <p className="mt-2 text-sm text-muted">{address}</p> : null}
            <p className="mt-2 text-sm text-ink-soft">
              {sourceAgeLabel(menu.meta, now, origin)}
              {refreshing ? <span className="ml-2 text-muted">Refreshing…</span> : null}
            </p>
          </div>
          <div className="w-full sm:w-72">
            <LocationSelector activeId={locationId} locations={locations} onLocationChange={requestLocationChange} />
          </div>
        </header>

        <StatusBanners menu={menu} online={online} origin={origin} refreshing={refreshing} />

        <div className="mt-8 grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-5 lg:self-start">
            <div className="rounded-[1.25rem] border border-line bg-surface p-4">
              <label className="block text-sm font-semibold text-ink" htmlFor="menu-search">Search menu</label>
              <div className="relative mt-1.5">
                <input
                  aria-controls={resultsId}
                  className="min-h-11 w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 pr-20 text-base text-ink placeholder:text-muted"
                  id="menu-search"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Coffee, oat, pastry…"
                  type="search"
                  value={search}
                />
                {search.length > 0 ? (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-semibold text-accent-deep hover:bg-accent-soft"
                    onClick={() => setSearch("")}
                    type="button"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-muted" id={resultsId}>
                {filteredItems.length} item{filteredItems.length === 1 ? "" : "s"}
                {search.trim().length > 0 || categoryId !== null ? " match your filters" : " available"}
              </p>
              <div aria-label="Menu categories" className="mt-5 flex gap-2 overflow-x-auto pb-1 lg:flex-col" role="group">
                <button
                  aria-pressed={categoryId === null}
                  className={`min-h-10 whitespace-nowrap rounded-xl px-3.5 py-2 text-left text-sm font-semibold transition ${categoryId === null ? "bg-ink text-white" : "bg-paper-deep text-ink-soft hover:bg-line/60"}`}
                  onClick={() => setCategoryId(null)}
                  type="button"
                >
                  All
                </button>
                {menu.data.categories.map((category) => (
                  <button
                    aria-pressed={categoryId === category.id}
                    className={`min-h-10 whitespace-nowrap rounded-xl px-3.5 py-2 text-left text-sm font-semibold transition ${categoryId === category.id ? "bg-ink text-white" : "bg-paper-deep text-ink-soft hover:bg-line/60"}`}
                    key={category.id}
                    onClick={() => setCategoryId(category.id)}
                    type="button"
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section aria-live="polite">
            {menu.data.items.length === 0 ? (
              <EmptyState
                body="This location has no visible menu items yet. Try another location, or check back after the catalog is updated."
                title="Nothing on the menu"
              />
            ) : null}
            {menu.data.items.length === 0 ? (
              <p className="sr-only">This location has no visible menu items yet.</p>
            ) : null}
            {menu.data.items.length > 0 && filteredItems.length === 0 ? (
              <EmptyState
                action={(
                  <button
                    className="min-h-11 rounded-xl border border-line bg-surface px-4 py-2 font-semibold text-ink hover:bg-paper"
                    onClick={() => {
                      setSearch("");
                      setCategoryId(null);
                    }}
                    type="button"
                  >
                    Clear filters
                  </button>
                )}
                body="No items match this search and category filter. Clear filters to see the full menu."
                title="No matches"
              />
            ) : null}
            {menu.data.items.length > 0 && filteredItems.length === 0 ? (
              <p className="sr-only">No items match this search and category filter.</p>
            ) : null}

            <div className="grid gap-10">
              {grouped.map((group) => (
                <section key={group.id}>
                  <div className="mb-4 flex items-end justify-between gap-3">
                    <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-ink">{group.name}</h2>
                    <p className="text-sm text-muted">{group.items.length}</p>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {group.items.map((item, index) => (
                      <ItemCard
                        availability={itemAvailability(availability, item.id)}
                        index={index}
                        item={item}
                        key={`${group.id}:${item.id}`}
                        locale={menu.data.location.locale}
                        locationId={locationId}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <CartPanel canMutate={canMutate} controls={cart} locale={menu.data.location.locale} notices={cart.notices} />
          </section>
        </div>
      </main>

      {pendingLocationId === null ? null : (
        <div
          aria-labelledby="location-change-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-6 backdrop-blur-[2px]"
          role="dialog"
        >
          <section className="animate-rise w-full max-w-md rounded-[1.5rem] border border-line bg-surface p-6 shadow-[var(--shadow)]">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink" id="location-change-title">
              Clear cart and change location?
            </h2>
            <p className="mt-3 text-ink-soft">
              Menu selections and prices can differ by location. Your current cart will be cleared.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                className="min-h-11 rounded-xl border border-line px-4 py-2 font-semibold text-ink hover:bg-paper"
                onClick={() => setPendingLocationId(null)}
                ref={cancelRef}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-11 rounded-xl bg-danger px-4 py-2 font-semibold text-white hover:bg-danger/90"
                onClick={confirmLocationChange}
                type="button"
              >
                Clear cart and change
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function MenuBrowser({ locationId, itemId }: { readonly itemId?: string; readonly locationId: string }) {
  const { error, loading, locations, menu, origin, refreshing, reload } = useMenuData(locationId);
  const online = useOnlineStatus();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const refreshClock = () => setNow(new Date());
    const delay = Math.max(1, nextMinuteBoundary(new Date()).getTime() - Date.now());
    const timeout = window.setTimeout(refreshClock, delay);
    window.addEventListener("focus", refreshClock);
    window.addEventListener("online", refreshClock);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("focus", refreshClock);
      window.removeEventListener("online", refreshClock);
    };
  }, [now]);

  if (loading) {
    return <LoadingState />;
  }
  if (error !== null) {
    if (error.code === "NOT_FOUND") {
      return <NotFoundState locationId={locationId} itemId={itemId} />;
    }
    return <ErrorState error={error} onRetry={() => void reload()} />;
  }
  if (menu === null || locations === null || !locations.data.locations.some((location) => location.id === locationId)) {
    return <NotFoundState locationId={locationId} />;
  }
  return (
    <MenuContent
      itemId={itemId}
      locationId={locationId}
      locations={locations.data.locations}
      menu={menu}
      now={now}
      online={online}
      origin={origin}
      refreshing={refreshing}
    />
  );
}

export function LocationRedirect() {
  const router = useRouter();
  const { error, load, loading, locations } = useLocationsBootstrap();

  useEffect(() => {
    const task = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(task);
  }, [load]);

  useEffect(() => {
    if (locations === null) {
      return;
    }
    const stored = window.localStorage.getItem(LAST_LOCATION_KEY);
    const target = locations.data.locations.find((location) => location.id === stored) ?? locations.data.locations[0];
    if (target === undefined) {
      return;
    }
    router.replace(`/locations/${target.id}`);
  }, [locations, router]);

  if (error !== null && locations === null) {
    return <ErrorState error={error} onRetry={() => void load()} />;
  }
  if (!loading && locations !== null && locations.data.locations.length === 0) {
    return <ErrorState error={new ApiClientError("There are no active locations to browse.", false)} onRetry={() => void load()} />;
  }
  return <LoadingState />;
}
