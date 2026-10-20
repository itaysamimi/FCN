"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  children: ReactNode;
  pendingText: string;
  variant?: "primary" | "secondary";
  className?: string;
};

const VARIANTS = {
  primary: "bg-primary text-text hover:bg-primary-dark",
  secondary: "border border-border bg-surface-raised text-text hover:border-primary",
};

// Disabled while its form is submitting, which also blocks double submits.
export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  className,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className ?? ""}`}
    >
      {pending && (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {pending ? pendingText : children}
    </button>
  );
}
