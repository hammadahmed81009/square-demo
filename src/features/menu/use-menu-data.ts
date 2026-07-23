"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createApiResponseSchema,
  locationsDataSchema,
  menuSnapshotSchema,
  PUBLIC_SCHEMA_VERSION,
  type ApiSuccessDto,
  type LocationsDataDto,
  type LocationDto,
  type MenuSnapshotDto,
  type WarningDto,
} from "@/shared/contracts";

import {
  markInventoryStale,
  readLocationsCache,
  readMenuCache,
  writeLocationsCache,
  writeMenuCache,
} from "./browser-cache";

export const LAST_LOCATION_KEY = "per-diem:last-location";
export const BROWSER_CACHE_REQUEST_ID = "00000000-0000-4000-8000-000000000099";

export type MenuResponse = ApiSuccessDto<MenuSnapshotDto>;
export type LocationsResponse = ApiSuccessDto<{ locations: LocationDto[] }>;
export type DataOrigin = "network" | "browser-cache";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

const INVENTORY_STALE_WARNING: WarningDto = {
  code: "BROWSER_CACHE_INVENTORY_STALE",
  message: "Inventory status may be outdated until the menu refreshes.",
};

function browserCacheMeta(cachedAt: string, warnings: readonly WarningDto[] = []): MenuResponse["meta"] {
  return {
    schemaVersion: PUBLIC_SCHEMA_VERSION,
    requestId: BROWSER_CACHE_REQUEST_ID,
    fetchedAt: cachedAt,
    source: "server-cache",
    warnings: [...warnings],
  };
}

export async function getApiData<TData>(
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

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  return online;
}

export function useMenuData(locationId: string) {
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [locations, setLocations] = useState<LocationsResponse | null>(null);
  const [origin, setOrigin] = useState<DataOrigin>("network");
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasContentRef = useRef(false);

  const applyNetworkSuccess = useCallback(
    (menuResponse: MenuResponse, locationsResponse: LocationsResponse) => {
      setMenu(menuResponse);
      setLocations(locationsResponse);
      setOrigin("network");
      setError(null);
      hasContentRef.current = true;
      window.localStorage.setItem(LAST_LOCATION_KEY, locationId);
      void writeMenuCache(locationId, menuResponse.data);
      void writeLocationsCache(locationsResponse.data);
    },
    [locationId],
  );

  const applyBrowserCache = useCallback(
    (
      menuPayload: MenuSnapshotDto,
      menuCachedAt: string,
      locationsPayload: LocationsDataDto,
      locationsCachedAt: string,
    ) => {
      setMenu({
        data: markInventoryStale(menuPayload),
        meta: browserCacheMeta(menuCachedAt, [INVENTORY_STALE_WARNING]),
      });
      setLocations({
        data: locationsPayload,
        meta: browserCacheMeta(locationsCachedAt),
      });
      setOrigin("browser-cache");
      setError(null);
      hasContentRef.current = true;
    },
    [],
  );

  const fetchNetwork = useCallback(async () => {
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
    return { menuResponse, locationsResponse };
  }, [locationId]);

  const reload = useCallback(async () => {
    setRefreshing(true);
    if (!hasContentRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const { menuResponse, locationsResponse } = await fetchNetwork();
      applyNetworkSuccess(menuResponse, locationsResponse);
    } catch (reason) {
      if (!hasContentRef.current) {
        setMenu(null);
        setLocations(null);
        setError(
          reason instanceof ApiClientError
            ? reason
            : new ApiClientError("The menu could not be loaded.", true),
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyNetworkSuccess, fetchNetwork]);

  useEffect(() => {
    let cancelled = false;
    const task = window.setTimeout(() => {
      void (async () => {
        hasContentRef.current = false;
        setMenu(null);
        setLocations(null);
        setOrigin("network");
        setError(null);
        setLoading(true);
        setRefreshing(false);

        const [menuCache, locationsCache] = await Promise.all([
          readMenuCache(locationId),
          readLocationsCache(),
        ]);
        if (cancelled) {
          return;
        }

        if (
          menuCache.status === "hit" &&
          locationsCache.status === "hit" &&
          locationsCache.payload.locations.some((location) => location.id === locationId)
        ) {
          applyBrowserCache(
            menuCache.payload,
            menuCache.cachedAt,
            locationsCache.payload,
            locationsCache.cachedAt,
          );
          setLoading(false);
        }

        setRefreshing(true);
        try {
          const { menuResponse, locationsResponse } = await fetchNetwork();
          if (cancelled) {
            return;
          }
          applyNetworkSuccess(menuResponse, locationsResponse);
        } catch (reason) {
          if (cancelled) {
            return;
          }
          if (!hasContentRef.current) {
            setMenu(null);
            setLocations(null);
            setError(
              reason instanceof ApiClientError
                ? reason
                : new ApiClientError("The menu could not be loaded.", true),
            );
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
            setRefreshing(false);
          }
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(task);
    };
  }, [applyBrowserCache, applyNetworkSuccess, fetchNetwork, locationId]);

  useEffect(() => {
    const refresh = () => {
      void reload();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [reload]);

  return { error, loading, locations, menu, origin, refreshing, reload };
}

export function useLocationsBootstrap() {
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<LocationsResponse | null>(null);
  const hasContentRef = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    if (!hasContentRef.current) {
      setLoading(true);
    }
    try {
      const cached = await readLocationsCache();
      if (cached.status === "hit" && cached.payload.locations.length > 0) {
        setLocations({
          data: cached.payload,
          meta: browserCacheMeta(cached.cachedAt),
        });
        hasContentRef.current = true;
        setLoading(false);
      }

      const response = await getApiData<{ locations: LocationDto[] }>(
        "/api/locations",
        createApiResponseSchema(locationsDataSchema),
      );
      setLocations(response);
      hasContentRef.current = true;
      setError(null);
      void writeLocationsCache(response.data);
    } catch (reason) {
      if (!hasContentRef.current) {
        setError(
          reason instanceof ApiClientError
            ? reason
            : new ApiClientError("The locations could not be loaded.", true),
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  return { error, load, loading, locations };
}
