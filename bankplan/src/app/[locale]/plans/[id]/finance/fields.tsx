"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";

const inputClass = "mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5";

/** A "?" button next to a field label; the short explanation opens under the field. */
function useHelp(label: string, help?: string) {
  const t = useTranslations("finance");
  const id = useId();
  const [open, setOpen] = useState(false);
  if (!help) return { button: null, text: null };
  return {
    button: (
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={id}
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-blue-700 text-xs font-semibold text-blue-700 hover:bg-blue-50"
      >
        ?<span className="sr-only">{` ${t("helpButton")} ${label}`}</span>
      </button>
    ),
    text: open ? (
      <p id={id} className="mt-1 rounded-md bg-blue-50 p-2 text-xs text-blue-900">
        {help}
      </p>
    ) : null,
  };
}

function parseNumber(text: string): number {
  const cleaned = text.replace(/\s/g, "").replace(",", ".");
  return cleaned === "" ? 0 : Number(cleaned);
}

/** Number input that accepts "1 500,50" as well as "1500.5". */
export function NumberField({
  label,
  value,
  onChange,
  suffix,
  help,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  /** Short plain-language explanation, opened with a "?" button. */
  help?: string;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const shown = parseNumber(text) === value ? text : String(value);
  const helpParts = useHelp(label, help);

  return (
    <div className="text-sm">
      <label htmlFor={id} className="text-slate-700">
        {label}
      </label>
      {helpParts.button}
      <div className="flex items-center gap-1">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={shown}
          onChange={(event) => {
            setText(event.target.value);
            const parsed = parseNumber(event.target.value);
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
          className={inputClass}
        />
        {suffix && <span className="mt-1 text-slate-500">{suffix}</span>}
      </div>
      {helpParts.text}
    </div>
  );
}

export function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="text-sm">
      <label htmlFor={id} className="text-slate-700">
        {label}
      </label>
      <input id={id} value={value} maxLength={100} onChange={(event) => onChange(event.target.value)} className={inputClass} />
    </div>
  );
}

export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
  help,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  help?: string;
}) {
  const id = useId();
  const helpParts = useHelp(label, help);
  return (
    <div className="text-sm">
      <label htmlFor={id} className="text-slate-700">
        {label}
      </label>
      {helpParts.button}
      <select
        id={id}
        value={String(value)}
        onChange={(event) => onChange(options.find((o) => String(o.value) === event.target.value)!.value)}
        className={inputClass}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
      {helpParts.text}
    </div>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
  help,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  help?: string;
}) {
  const helpParts = useHelp(label, help);
  return (
    <div className="text-sm">
      <div className="flex items-start">
        <label className="flex items-start gap-2 text-slate-700">
          <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5" />
          <span>{label}</span>
        </label>
        {helpParts.button}
      </div>
      {helpParts.text}
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {hint && <p className="text-sm text-slate-600">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** A removable row inside a list section (one product, one cost, …). */
export function LineCard({ onRemove, removeLabel, children }: { onRemove: () => void; removeLabel: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      <button type="button" onClick={onRemove} className="text-sm text-red-700 underline">
        {removeLabel}
      </button>
    </div>
  );
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-blue-700 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50"
    >
      + {label}
    </button>
  );
}
