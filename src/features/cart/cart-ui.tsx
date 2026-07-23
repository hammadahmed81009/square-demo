"use client";

import { useMemo, useState } from "react";

import type { ItemOrderability } from "@/features/menu/availability";
import type { CartLine, CartState, MenuItemDto } from "@/shared/contracts";
import { formatMoney, reasonLabel } from "@/features/menu/browse-utils";

import {
  cartSubtotal,
  createCartLine,
  createDefaultModifierDraft,
  groupSelectionQuantity,
  modifierQuantity,
  type ModifierDraft,
  validateModifierConfiguration,
} from "./cart";

interface CartControls {
  readonly cart: CartState;
  readonly clear: () => void;
  readonly decrement: (key: string) => void;
  readonly increment: (key: string) => void;
  readonly remove: (key: string) => void;
}

function modifierPrice(amountMinor: string, currency: string, locale: string): string {
  return formatMoney({ amountMinor, currency }, locale);
}

function variationOrderability(
  availability: ItemOrderability | undefined,
  variationId: string,
) {
  return availability?.variations.find((variation) => variation.id === variationId);
}

export function ItemConfigurator({
  availability,
  canMutate,
  currency,
  item,
  locale,
  onAdd,
}: {
  readonly availability: ItemOrderability | undefined;
  readonly canMutate: boolean;
  readonly currency: string;
  readonly item: MenuItemDto;
  readonly locale: string;
  readonly onAdd: (line: CartLine) => void;
}) {
  const validVariations = item.variations.filter((variation) => variationOrderability(availability, variation.id)?.orderable === true);
  const [variationId, setVariationId] = useState<string | null>(() => validVariations.length === 1 ? validVariations[0]?.id ?? null : null);
  const [draft, setDraft] = useState<ModifierDraft>(() => createDefaultModifierDraft(item));
  const [submittedErrors, setSubmittedErrors] = useState<readonly string[]>([]);
  const [justAdded, setJustAdded] = useState(false);
  const selectedAvailability = variationId === null ? undefined : variationOrderability(availability, variationId);
  const modifierValidation = useMemo(
    () => validateModifierConfiguration(item, draft, currency),
    [currency, draft, item],
  );
  const disabledReason = !canMutate
    ? "Cart changes are unavailable until this menu has a fresh online response."
    : variationId === null
      ? "Choose an available option."
      : selectedAvailability?.orderable !== true
        ? reasonLabel(selectedAvailability?.reason ?? "variation_not_sellable", selectedAvailability?.nextOpening ?? null, locale)
        : !modifierValidation.valid
          ? modifierValidation.errors.join(" ")
          : null;

  function updateListQuantity(groupId: string, optionId: string, quantity: number) {
    setDraft((current) => {
      const group = { ...(current.list[groupId] ?? {}) };
      if (quantity < 1) {
        delete group[optionId];
      } else {
        group[optionId] = Math.min(99, quantity);
      }
      return { ...current, list: { ...current.list, [groupId]: group } };
    });
  }

  function submit() {
    if (variationId === null || selectedAvailability?.orderable !== true || !canMutate) {
      return;
    }
    const built = createCartLine(item, variationId, draft);
    if (!built.valid) {
      setSubmittedErrors(built.errors);
      return;
    }
    onAdd(built.line);
    setSubmittedErrors([]);
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1600);
  }

  return (
    <section aria-labelledby="configure-heading" className="mt-8 rounded-[1.5rem] border border-line bg-surface p-5 shadow-[var(--shadow)] sm:p-6">
      <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink" id="configure-heading">
        Configure and add
      </h2>
      <p className="mt-1 text-sm text-muted">Pick an option, adjust customizations, then add to your cart.</p>

      <fieldset className="mt-5">
        <legend className="font-semibold text-ink">Choose an option</legend>
        <div className="mt-3 grid gap-2">
          {item.variations.map((variation) => {
            const state = variationOrderability(availability, variation.id);
            const orderable = state?.orderable === true;
            const selected = variationId === variation.id;
            return (
              <label
                className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-3 transition ${
                  selected
                    ? "border-accent bg-accent-soft/60"
                    : orderable
                      ? "border-line hover:border-ink/25"
                      : "cursor-not-allowed border-line/70 bg-paper-deep text-muted"
                }`}
                key={variation.id}
              >
                <span className="flex items-center gap-3">
                  <input
                    checked={selected}
                    className="size-4 accent-[var(--accent)]"
                    disabled={!canMutate || !orderable}
                    name="variation"
                    onChange={() => setVariationId(variation.id)}
                    type="radio"
                    value={variation.id}
                  />
                  {variation.name}
                </span>
                <span className="text-right text-sm font-semibold">
                  {variation.price === null
                    ? "Price varies"
                    : modifierPrice(variation.price.amountMinor, variation.price.currency, locale)}
                  {!orderable ? (
                    <span className="mt-1 block font-normal text-warn">
                      {reasonLabel(state?.reason ?? "variation_not_sellable", state?.nextOpening ?? null, locale)}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {item.modifierGroups.map((group) => group.type === "text" ? (
        <fieldset className="mt-6" key={group.id}>
          <legend className="font-semibold text-ink">
            {group.name}{" "}
            {group.required ? <span className="text-danger">(required)</span> : <span className="font-normal text-muted">(optional)</span>}
          </legend>
          <label className="mt-2 block text-sm text-muted" htmlFor={`modifier-${group.id}`}>
            Up to {group.maximumCodePoints} characters
          </label>
          <input
            className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 disabled:bg-paper-deep"
            disabled={!canMutate}
            id={`modifier-${group.id}`}
            onChange={(event) => setDraft((current) => ({ ...current, text: { ...current.text, [group.id]: event.target.value } }))}
            type="text"
            value={draft.text[group.id] ?? ""}
          />
        </fieldset>
      ) : (
        <fieldset className="mt-6" key={group.id}>
          <legend className="font-semibold text-ink">
            {group.name}{" "}
            {group.minimumSelections > 0
              ? <span className="text-danger">(required)</span>
              : <span className="font-normal text-muted">(optional)</span>}
          </legend>
          <p className="mt-1 text-sm text-muted">
            Choose {group.minimumSelections > 0 ? `${group.minimumSelections}–${group.maximumSelections || "any"}` : `up to ${group.maximumSelections || "any"}`}.
          </p>
          <div className="mt-3 grid gap-2">
            {group.options.map((option) => {
              const quantity = modifierQuantity(draft, group.id, option.id);
              const selectedTotal = groupSelectionQuantity(draft, group.id);
              const limitReached = group.maximumSelections > 0 && selectedTotal >= group.maximumSelections && quantity === 0;
              return (
                <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-3" key={option.id}>
                  <label className="flex items-center gap-3 text-sm font-medium text-ink">
                    <input
                      checked={quantity > 0}
                      className="size-4 accent-[var(--accent)]"
                      disabled={!canMutate || limitReached}
                      onChange={(event) => updateListQuantity(group.id, option.id, event.target.checked ? 1 : 0)}
                      type="checkbox"
                    />
                    {option.name}
                    {option.price.amountMinor === "0" ? "" : ` (+${modifierPrice(option.price.amountMinor, option.price.currency, locale)})`}
                  </label>
                  {group.allowQuantities && quantity > 0 ? (
                    <label className="text-sm text-muted">
                      Qty{" "}
                      <input
                        aria-label={`${option.name} quantity`}
                        className="ml-1 w-14 rounded-lg border border-line px-2 py-1"
                        disabled={!canMutate}
                        max={Math.min(99, group.maximumSelections || 99)}
                        min="1"
                        onChange={(event) => updateListQuantity(group.id, option.id, Number(event.target.value))}
                        type="number"
                        value={quantity}
                      />
                    </label>
                  ) : null}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}

      {submittedErrors.length > 0 ? (
        <ul aria-live="assertive" className="mt-4 list-disc rounded-xl bg-danger-soft p-4 pl-8 text-sm text-danger">
          {submittedErrors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      ) : null}
      {disabledReason !== null ? (
        <p className="mt-4 rounded-xl bg-warn-soft px-3.5 py-3 text-sm text-warn" id="add-to-cart-reason">
          {disabledReason}
        </p>
      ) : null}
      {justAdded ? (
        <p aria-live="polite" className="mt-4 text-sm font-medium text-ok">Added to cart</p>
      ) : null}
      <button
        aria-describedby={disabledReason === null ? undefined : "add-to-cart-reason"}
        className="mt-5 min-h-11 rounded-xl bg-ink px-5 py-2.5 font-semibold text-white transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:bg-muted"
        disabled={disabledReason !== null}
        onClick={submit}
        type="button"
      >
        Add to cart
      </button>
    </section>
  );
}

export function CartPanel({
  canMutate,
  controls,
  locale,
  notices,
}: {
  readonly canMutate: boolean;
  readonly controls: CartControls;
  readonly locale: string;
  readonly notices: readonly string[];
}) {
  const subtotal = cartSubtotal(controls.cart);
  const lineCount = controls.cart.lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <section aria-labelledby="cart-heading" className="mt-8 rounded-[1.5rem] border border-line bg-surface p-5 shadow-[var(--shadow)] sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink" id="cart-heading">
            Cart
          </h2>
          <p className="text-sm text-muted">
            {lineCount === 0 ? "No items yet" : `${lineCount} item${lineCount === 1 ? "" : "s"}`}
          </p>
        </div>
        {controls.cart.lines.length > 0 ? (
          <button
            className="min-h-10 text-sm font-semibold text-danger underline-offset-4 hover:underline disabled:text-muted disabled:no-underline"
            disabled={!canMutate}
            onClick={controls.clear}
            type="button"
          >
            Clear cart
          </button>
        ) : null}
      </div>

      {notices.length > 0 ? (
        <ul aria-live="polite" className="mt-4 list-disc rounded-xl bg-warn-soft p-4 pl-8 text-sm text-warn">
          {notices.map((notice) => <li key={notice}>{notice}</li>)}
        </ul>
      ) : null}

      {controls.cart.lines.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Your cart is empty.</p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {controls.cart.lines.map((line) => (
            <CartLineView canMutate={canMutate} controls={controls} key={line.key} line={line} locale={locale} />
          ))}
        </ul>
      )}

      <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
        <span className="font-semibold text-ink">Active subtotal</span>
        <span className="font-[family-name:var(--font-display)] text-xl font-semibold text-ink">
          {formatMoney(subtotal, locale)}
        </span>
      </div>
      {!canMutate ? (
        <p className="mt-3 rounded-xl bg-warn-soft px-3.5 py-3 text-sm text-warn">
          Cart changes are disabled until a fresh online menu response is available.
        </p>
      ) : null}
    </section>
  );
}

function CartLineView({
  canMutate,
  controls,
  line,
  locale,
}: {
  readonly canMutate: boolean;
  readonly controls: CartControls;
  readonly line: CartLine;
  readonly locale: string;
}) {
  return (
    <li className={`rounded-2xl border p-4 ${line.availability.status === "active" ? "border-line" : "border-warn/40 bg-warn-soft"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">{line.itemName}</p>
          <p className="text-sm text-muted">{line.variationName}</p>
          {line.selections.map((selection) => (
            <p
              className="text-xs text-muted"
              key={`${selection.groupId}:${selection.type === "list" ? selection.optionId : selection.value}`}
            >
              {selection.type === "list" ? `${selection.quantity}× ${selection.name}` : `${selection.name}: ${selection.value}`}
            </p>
          ))}
        </div>
        <button
          aria-label={`Remove ${line.itemName}`}
          className="text-sm font-semibold text-danger underline-offset-4 hover:underline disabled:text-muted"
          disabled={!canMutate}
          onClick={() => controls.remove(line.key)}
          type="button"
        >
          Remove
        </button>
      </div>
      {line.availability.status === "unavailable" ? (
        <p className="mt-2 text-sm text-warn">{line.availability.reason}</p>
      ) : (
        <div className="mt-3 flex items-center gap-3">
          <button
            aria-label={`Decrease ${line.itemName} quantity`}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-line text-lg disabled:text-muted"
            disabled={!canMutate}
            onClick={() => controls.decrement(line.key)}
            type="button"
          >
            −
          </button>
          <span aria-label={`${line.itemName} quantity`} className="min-w-6 text-center font-semibold">
            {line.quantity}
          </span>
          <button
            aria-label={`Increase ${line.itemName} quantity`}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-line text-lg disabled:text-muted"
            disabled={!canMutate || line.quantity >= 99}
            onClick={() => controls.increment(line.key)}
            type="button"
          >
            +
          </button>
          <span className="ml-auto text-sm font-semibold text-ink-soft">
            {formatMoney(line.unitBasePrice, locale)}
          </span>
        </div>
      )}
    </li>
  );
}
