"use client";

import { useFormStatus } from "react-dom";

/** A form button that shows a "working…" label while the form is being sent. */
export function SubmitButton({
  label,
  pendingLabel,
  variant = "primary",
  disabled = false,
}: {
  label: string;
  pendingLabel: string;
  variant?: "primary" | "danger" | "secondary";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const styles = {
    primary: "bg-blue-700 text-white hover:bg-blue-800",
    danger: "bg-red-700 text-white hover:bg-red-800",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
  }[variant];

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`rounded-md px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-60 ${styles}`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
