"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { CONDITION_OPTIONS, type CatalogCategory } from "@/lib/catalog";
import {
  centsToDollars,
  dollarsToCents,
  type ListingInput,
  type SellerListing,
} from "@/lib/sellerApi";

const inputClass =
  "mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-sm text-ink outline-none focus:border-gold";
const labelClass = "text-sm font-medium text-ink";
const errorClass = "mt-1 text-xs text-clay";

export default function ListingForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: SellerListing;
  submitLabel: string;
  onSubmit: (input: ListingInput) => Promise<void>;
}) {
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [categoryId, setCategoryId] = useState(initial?.category.id ?? "");
  const [condition, setCondition] = useState(initial?.condition ?? "GOOD");
  const [conditionNote, setConditionNote] = useState(initial?.conditionNote ?? "");
  const [price, setPrice] = useState(centsToDollars(initial?.priceCents ?? null));
  const [originalPrice, setOriginalPrice] = useState(
    centsToDollars(initial?.originalPriceCents ?? null)
  );
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? 1));

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/catalog/categories")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (cancelled) return;
        setCategories(data.categories ?? []);
        // Only default once the real list is known, so we never post a guess.
        if (!initial && data.categories?.length) {
          setCategoryId((current: string) => current || data.categories[0].id);
        }
      })
      .catch(() => {
        if (!cancelled) setFormError("Couldn't load categories. Reload and try again.");
      });

    return () => {
      cancelled = true;
    };
  }, [initial]);

  function errorFor(field: string) {
    return fieldError?.field === field ? fieldError.message : null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFieldError(null);

    const priceCents = dollarsToCents(price);
    if (priceCents === null || priceCents < 1) {
      setFieldError({ field: "priceCents", message: "Enter a price." });
      return;
    }

    const originalCents = originalPrice.trim() ? dollarsToCents(originalPrice) : null;
    if (originalPrice.trim() && originalCents === null) {
      setFieldError({ field: "originalPriceCents", message: "That isn't a valid amount." });
      return;
    }
    if (originalCents !== null && originalCents <= priceCents) {
      setFieldError({
        field: "originalPriceCents",
        message: "The original price has to be higher than the current one.",
      });
      return;
    }

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      setFieldError({ field: "quantity", message: "Quantity must be at least 1." });
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        categoryId,
        condition,
        conditionNote: conditionNote.trim() || null,
        priceCents,
        originalPriceCents: originalCents,
        quantity: qty,
      });
    } catch (err) {
      if (err instanceof ApiError && err.field) {
        setFieldError({ field: err.field, message: err.message });
      } else if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 grid gap-6" noValidate>
      <div>
        <label htmlFor="title" className={labelClass}>
          Title
        </label>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Walnut side table"
          className={inputClass}
        />
        {errorFor("title") && <p className={errorClass}>{errorFor("title")}</p>}
      </div>

      <div>
        <label htmlFor="description" className={labelClass}>
          Description
        </label>
        <p className="mt-0.5 text-xs text-ink-dim">
          Say what&apos;s wrong with it as well as what&apos;s right. Buyers here expect
          honesty.
        </p>
        <textarea
          id="description"
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Solid walnut, one water ring on the top that I haven't sanded out…"
          className={inputClass}
        />
        {errorFor("description") && <p className={errorClass}>{errorFor("description")}</p>}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="categoryId" className={labelClass}>
            Category
          </label>
          <select
            id="categoryId"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={inputClass}
          >
            {categories.length === 0 && <option value="">Loading…</option>}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          {errorFor("categoryId") && <p className={errorClass}>{errorFor("categoryId")}</p>}
        </div>

        <div>
          <label htmlFor="condition" className={labelClass}>
            Condition
          </label>
          <select
            id="condition"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            className={inputClass}
          >
            {CONDITION_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="conditionNote" className={labelClass}>
          Condition note <span className="font-normal text-ink-dim">(optional)</span>
        </label>
        <p className="mt-0.5 text-xs text-ink-dim">
          Your own words, shown on the card — &ldquo;Needs a tune-up&rdquo;, &ldquo;Water
          ring&rdquo;.
        </p>
        <input
          id="conditionNote"
          value={conditionNote}
          onChange={(e) => setConditionNote(e.target.value)}
          maxLength={60}
          className={inputClass}
        />
        {errorFor("conditionNote") && <p className={errorClass}>{errorFor("conditionNote")}</p>}
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        <div>
          <label htmlFor="price" className={labelClass}>
            Price ($)
          </label>
          <input
            id="price"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={inputClass}
          />
          {errorFor("priceCents") && <p className={errorClass}>{errorFor("priceCents")}</p>}
        </div>

        <div>
          <label htmlFor="originalPrice" className={labelClass}>
            Was ($) <span className="font-normal text-ink-dim">(optional)</span>
          </label>
          <input
            id="originalPrice"
            type="number"
            min="0"
            step="0.01"
            value={originalPrice}
            onChange={(e) => setOriginalPrice(e.target.value)}
            className={inputClass}
          />
          {errorFor("originalPriceCents") && (
            <p className={errorClass}>{errorFor("originalPriceCents")}</p>
          )}
        </div>

        <div>
          <label htmlFor="quantity" className={labelClass}>
            Quantity
          </label>
          <input
            id="quantity"
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={inputClass}
          />
          {errorFor("quantity") && <p className={errorClass}>{errorFor("quantity")}</p>}
        </div>
      </div>

      {formError && (
        <p className="rounded-xl border border-clay/30 bg-clay/10 px-4 py-3 text-sm text-clay">
          {formError}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-gold-dim px-6 py-2.5 text-sm font-semibold text-paper transition hover:brightness-90 disabled:opacity-60"
        >
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
