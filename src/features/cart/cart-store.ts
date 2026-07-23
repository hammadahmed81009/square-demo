"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { ItemOrderability } from "@/features/menu/availability";
import type { CartLine, CartState, MenuSnapshotDto } from "@/shared/contracts";
import { restoreCartState } from "@/shared/contracts";

import {
  cartReducer,
  createEmptyCart,
  reconcileCart,
} from "./cart";

const CART_STORAGE_KEY = "per-diem:cart:v1";

function storedCart(locationId: string, currency: string): CartState {
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (raw === null) {
      return createEmptyCart(locationId, currency);
    }
    const restored = restoreCartState(JSON.parse(raw));
    if (restored.status === "restored" && restored.cart.locationId === locationId && restored.cart.currency === currency) {
      return restored.cart;
    }
  } catch {
    // A corrupt cart must never prevent menu browsing.
  }
  window.localStorage.removeItem(CART_STORAGE_KEY);
  return createEmptyCart(locationId, currency);
}

export function useLocationCart(
  locationId: string,
  currency: string,
  snapshot: MenuSnapshotDto,
  availability: readonly ItemOrderability[],
) {
  const [cart, dispatch] = useReducer(cartReducer, createEmptyCart(locationId, currency));
  const [hydrated, setHydrated] = useState(false);
  const [notices, setNotices] = useState<readonly string[]>([]);
  const latestCart = useRef(cart);

  useEffect(() => {
    latestCart.current = cart;
  }, [cart]);

  useEffect(() => {
    const task = window.setTimeout(() => {
      dispatch({ cart: storedCart(locationId, currency), type: "replace" });
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(task);
  }, [currency, locationId]);

  useEffect(() => {
    if (!hydrated) {
      return undefined;
    }
    const task = window.setTimeout(() => {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(latestCart.current));
    }, 0);
    return () => window.clearTimeout(task);
  }, [cart, hydrated]);

  useEffect(() => {
    if (!hydrated) {
      return undefined;
    }
    const task = window.setTimeout(() => {
      const result = reconcileCart(latestCart.current, snapshot, availability);
      if (JSON.stringify(result.cart) !== JSON.stringify(latestCart.current)) {
        dispatch({ cart: result.cart, type: "replace" });
      }
      setNotices(result.notices);
    }, 0);
    return () => window.clearTimeout(task);
  }, [availability, hydrated, snapshot]);

  const add = useCallback((line: CartLine) => dispatch({ line, type: "add" }), []);
  const decrement = useCallback((key: string) => dispatch({ key, type: "decrement" }), []);
  const increment = useCallback((key: string) => dispatch({ key, type: "increment" }), []);
  const remove = useCallback((key: string) => dispatch({ key, type: "remove" }), []);
  const clear = useCallback(() => {
    window.localStorage.removeItem(CART_STORAGE_KEY);
    dispatch({ type: "clear" });
    setNotices([]);
  }, []);

  return { add, cart, clear, decrement, hydrated, increment, notices, remove };
}
