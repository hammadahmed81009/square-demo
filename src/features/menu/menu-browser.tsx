"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createApiResponseSchema,
  locationsDataSchema,
  menuSnapshotSchema,
  type ApiSuccessDto,
  type LocationDto,
  type MenuItemDto,
  type MenuSnapshotDto,
} from "@/shared/contracts";
import {
  evaluateMenuOrderability,
  nextMinuteBoundary,
  type ItemOrderability,
} from "@/features/menu/availability";

import {
  filterMenuItems,
  itemAvailability,
  itemPriceLabel,
  reasonLabel,
  sourceAgeLabel,
} from "./browse-utils";

const LAST_LOCATION_KEY = "per-diem:last-location";

type MenuResponse = ApiSuccessDto<MenuSnapshotDto>;
type LocationsResponse = ApiSuccessDto<{ locations: LocationDto[] }>;

class ApiClientError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function getApiData<TData>(
  path: string,
  schema: ReturnType<typeof createApiResponseSchema>,
): Promise<ApiSuccessDto<TData>> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", headers: { accept: "application/json" } });
  } catch {
    throw new ApiClientError("Unable to reach the menu service. Check your connection and retry.", true);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiClientError("The menu service returned an invalid response.", true);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiClientError("The menu service returned an invalid response.", true);
  }
  if ("error" in parsed.data) {
    throw new ApiClientError(
      parsed.data.error.message,
      parsed.data.error.retryable,
      parsed.data.error.code,
    );
  }
  if (!response.ok) {
    throw new ApiClientError("The menu service could not complete this request.", true);
  }
  return parsed.data as ApiSuccessDto<TData>;
}

function useMenuData(locationId: string) {
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [locations, setLocations] = useState<LocationsResponse | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [menuResponse, locationsResponse] = await Promise.all([
        getApiData<MenuSnapshotDto>(
          `/api/menu?locationId=${encodeURIComponent(locationId)}`,
          createApiResponseSchema(menuSnapshotSchema),
        ),
        getApiData<{ locations: LocationDto[] }>(
          "/api/locations",
          createApiResponseSchema(locationsDataSchema),
        ),
      ]);
      setMenu(menuResponse);
      setLocations(locationsResponse);
      window.localStorage.setItem(LAST_LOCATION_KEY, locationId);
    } catch (reason) {
      setMenu(null);
      setLocations(null);
      setError(
        reason instanceof ApiClientError
          ? reason
          : new ApiClientError("The menu could not be loaded.", true),
      );
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    const task = window.setTimeout(() => {
      void reload();
    }, 0);
    return () => window.clearTimeout(task);
  }, [reload]);

  return { error, loading, locations, menu, reload };
}

function MenuImage({ alt, src }: { readonly alt: string; readonly src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (src === null || failed) {
    return (
      <div
        aria-label={`${alt} image unavailable`}
        className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-orange-100 text-sm font-medium text-orange-900"
        role="img"
      >
        Per Diem
      </div>
    );
  }
  return (
    <Image
      alt={alt}
      className="aspect-[4/3] w-full rounded-2xl object-cover"
      height={360}
      onError={() => setFailed(true)}
      src={src}
      width={480}
    />
  );
}

function LoadingState() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-10">
      <div className="h-8 w-56 animate-pulse rounded bg-slate-200" />
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {["one", "two", "three"].map((key) => (
          <div className="h-80 animate-pulse rounded-3xl bg-slate-100" key={key} />
        ))}
      </div>
      <p className="sr-only">Loading the location menu.</p>
    </main>
  );
}

function ErrorState({ error, onRetry }: { readonly error: ApiClientError; readonly onRetry: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10">
      <section aria-live="assertive" className="rounded-3xl border border-rose-200 bg-rose-50 p-7">
        <p className="text-sm font-semibold uppercase tracking-wide text-rose-700">Menu unavailable</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">We could not load this menu.</h1>
        <p className="mt-3 text-slate-700">{error.message}</p>
        {error.retryable ? (
          <button className="mt-6 rounded-xl bg-slate-950 px-4 py-2 font-semibold text-white" onClick={onRetry} type="button">
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
}: {
  readonly activeId: string;
  readonly locations: readonly LocationDto[];
}) {
  const router = useRouter();
  return (
    <label className="block text-sm font-semibold text-slate-800">
      Location
      <select
        aria-label="Choose location"
        className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base shadow-sm"
        onChange={(event) => router.push(`/locations/${event.target.value}`)}
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
    <p className={`mt-3 text-sm font-medium ${available ? "text-emerald-700" : "text-amber-800"}`}>
      {reasonLabel(availability.reason, availability.nextOpening, locale)}
    </p>
  );
}

function ItemCard({
  availability,
  item,
  locationId,
  locale,
}: {
  readonly availability: ItemOrderability | undefined;
  readonly item: MenuItemDto;
  readonly locationId: string;
  readonly locale: string;
}) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <MenuImage alt={item.name} src={item.imageUrl} />
      <div className="px-1 pt-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-950">{item.name}</h3>
          <span className="shrink-0 text-sm font-semibold text-slate-800">{itemPriceLabel(item, locale)}</span>
        </div>
        {item.description.length > 0 ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{item.description}</p> : null}
        <AvailabilityBadge availability={availability} locale={locale} />
        <Link
          aria-label={`View ${item.name} details`}
          className="mt-4 inline-flex rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700"
          href={`/locations/${locationId}/items/${item.id}`}
        >
          View details
        </Link>
      </div>
    </article>
  );
}

function DetailView({
  availability,
  item,
  locale,
  locationId,
}: {
  readonly availability: ItemOrderability | undefined;
  readonly item: MenuItemDto;
  readonly locale: string;
  readonly locationId: string;
}) {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10 sm:px-10">
      <Link className="text-sm font-semibold text-orange-800 underline" href={`/locations/${locationId}`}>Back to menu</Link>
      <article className="mt-5 grid gap-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2 md:p-8">
        <MenuImage alt={item.name} src={item.imageUrl} />
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-orange-800">Item details</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{item.name}</h1>
          <p className="mt-3 text-lg font-semibold text-slate-800">{itemPriceLabel(item, locale)}</p>
          {item.description.length > 0 ? <p className="mt-4 leading-7 text-slate-700">{item.description}</p> : null}
          <AvailabilityBadge availability={availability} locale={locale} />
        </div>
      </article>
      <section aria-labelledby="variation-heading" className="mt-8">
        <h2 className="text-xl font-bold text-slate-950" id="variation-heading">Options</h2>
        <ul className="mt-3 grid gap-3">
          {item.variations.map((variation) => {
            const state = availability?.variations.find((candidate) => candidate.id === variation.id);
            return (
              <li className="rounded-2xl border border-slate-200 bg-white p-4" key={variation.id}>
                <div className="flex items-center justify-between gap-4">
                  <span className="font-semibold text-slate-950">{variation.name}</span>
                  <span className="text-sm font-semibold text-slate-800">
                    {variation.price === null ? "Price varies" : itemPriceLabel({ ...item, variations: [variation] }, locale)}
                  </span>
                </div>
                {state === undefined || state.reason === "orderable" ? null : (
                  <p className="mt-2 text-sm text-amber-800">{reasonLabel(state.reason, state.nextOpening, locale)}</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {item.modifierGroups.length > 0 ? (
        <section aria-labelledby="modifier-heading" className="mt-8">
          <h2 className="text-xl font-bold text-slate-950" id="modifier-heading">Customizations</h2>
          <ul className="mt-3 grid gap-3">
            {item.modifierGroups.map((group) => (
              <li className="rounded-2xl border border-slate-200 bg-white p-4" key={group.id}>
                <p className="font-semibold text-slate-950">{group.name}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {group.type === "text"
                    ? `${group.required ? "Required" : "Optional"} text, up to ${group.maximumCodePoints} characters.`
                    : `${group.minimumSelections > 0 ? "Required" : "Optional"}; choose up to ${group.maximumSelections || "any"}.`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function NotFoundState({ locationId, itemId }: { readonly locationId: string; readonly itemId?: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10">
      <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-600">Not found</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">{itemId === undefined ? "This location is unavailable." : "This item is unavailable."}</h1>
        <p className="mt-3 text-slate-700">Choose an active location to continue browsing the menu.</p>
        <Link className="mt-6 inline-flex rounded-xl bg-slate-950 px-4 py-2 font-semibold text-white" href={itemId === undefined ? "/" : `/locations/${locationId}`}>Continue</Link>
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
}: {
  readonly itemId?: string;
  readonly locationId: string;
  readonly locations: readonly LocationDto[];
  readonly menu: MenuResponse;
  readonly now: Date;
}) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  const availability = evaluateMenuOrderability({
    isOnline: online,
    isSnapshotFresh: menu.meta.source !== "server-stale",
    now,
    snapshot: menu.data,
  }).items;
  const filteredItems = useMemo(
    () => filterMenuItems(menu.data, categoryId, search),
    [categoryId, menu.data, search],
  );

  useEffect(() => {
    headingRef.current?.focus();
  }, [itemId, locationId]);

  if (itemId !== undefined) {
    const item = menu.data.items.find((candidate) => candidate.id === itemId);
    return item === undefined
      ? <NotFoundState itemId={itemId} locationId={locationId} />
      : <DetailView availability={itemAvailability(availability, item.id)} item={item} locale={menu.data.location.locale} locationId={locationId} />;
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
    <main className="mx-auto w-full max-w-6xl px-6 py-8 sm:px-10">
      <header className="flex flex-col gap-5 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-orange-800">Per Diem menu</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950" ref={headingRef} tabIndex={-1}>{menu.data.location.name}</h1>
          <p className="mt-2 text-sm text-slate-600">{sourceAgeLabel(menu.meta, now)}</p>
        </div>
        <div className="w-full sm:w-64"><LocationSelector activeId={locationId} locations={locations} /></div>
      </header>
      {menu.meta.source === "server-stale" ? <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status">This is a server-stale menu snapshot. Browsing is available, but ordering controls are disabled until it refreshes.</p> : null}
      {menu.meta.warnings.length > 0 ? <section className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-4" aria-label="Menu notices"><p className="font-semibold text-sky-950">Menu notices</p><ul className="mt-2 list-disc pl-5 text-sm text-sky-900">{menu.meta.warnings.map((warning) => <li key={`${warning.code}:${warning.message}`}>{warning.message}</li>)}</ul></section> : null}
      <div className="mt-7 grid gap-4 lg:grid-cols-[15rem_1fr]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <label className="block text-sm font-semibold text-slate-800" htmlFor="menu-search">Search menu</label>
          <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" id="menu-search" onChange={(event) => setSearch(event.target.value)} placeholder="Coffee, oat, pastry…" type="search" value={search} />
          <div aria-label="Menu categories" className="mt-5 flex gap-2 overflow-x-auto pb-1 lg:flex-col" role="group">
            <button aria-pressed={categoryId === null} className={`whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm font-semibold ${categoryId === null ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-800"}`} onClick={() => setCategoryId(null)} type="button">All</button>
            {menu.data.categories.map((category) => <button aria-pressed={categoryId === category.id} className={`whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm font-semibold ${categoryId === category.id ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-800"}`} key={category.id} onClick={() => setCategoryId(category.id)} type="button">{category.name}</button>)}
          </div>
        </aside>
        <section aria-live="polite">
          {menu.data.items.length === 0 ? <p className="rounded-3xl border border-slate-200 bg-white p-8 text-slate-700">This location has no visible menu items yet.</p> : null}
          {menu.data.items.length > 0 && filteredItems.length === 0 ? <p className="rounded-3xl border border-slate-200 bg-white p-8 text-slate-700">No items match this search and category filter.</p> : null}
          <div className="grid gap-10">
            {grouped.map((group) => <section key={group.id}><h2 className="text-xl font-bold text-slate-950">{group.name}</h2><div className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{group.items.map((item) => <ItemCard availability={itemAvailability(availability, item.id)} item={item} key={`${group.id}:${item.id}`} locale={menu.data.location.locale} locationId={locationId} />)}</div></section>)}
          </div>
        </section>
      </div>
    </main>
  );
}

export function MenuBrowser({ locationId, itemId }: { readonly itemId?: string; readonly locationId: string }) {
  const { error, loading, locations, menu, reload } = useMenuData(locationId);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const refreshClock = () => setNow(new Date());
    const schedule = () => window.setTimeout(refreshClock, Math.max(1, nextMinuteBoundary(new Date()).getTime() - Date.now()));
    const timeout = schedule();
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
  return <MenuContent itemId={itemId} locationId={locationId} locations={locations.data.locations} menu={menu} now={now} />;
}

export function LocationRedirect() {
  const router = useRouter();
  const [error, setError] = useState<ApiClientError | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await getApiData<{ locations: LocationDto[] }>(
        "/api/locations",
        createApiResponseSchema(locationsDataSchema),
      );
      const stored = window.localStorage.getItem(LAST_LOCATION_KEY);
      const target = response.data.locations.find((location) => location.id === stored) ?? response.data.locations[0];
      if (target === undefined) {
        setError(new ApiClientError("There are no active locations to browse.", false));
        return;
      }
      router.replace(`/locations/${target.id}`);
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason : new ApiClientError("The locations could not be loaded.", true));
    }
  }, [router]);

  useEffect(() => {
    const task = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(task);
  }, [load]);

  return error === null ? <LoadingState /> : <ErrorState error={error} onRetry={() => void load()} />;
}
