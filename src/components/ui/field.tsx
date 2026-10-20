import type { InputHTMLAttributes } from "react";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
};

export function Field({ label, name, id, className, ...inputProps }: FieldProps) {
  const inputId = id ?? name;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm text-text-muted">
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        className={`h-11 rounded-xl border border-border bg-surface-raised px-3 text-text outline-none transition placeholder:text-text-muted/60 focus:border-primary focus:ring-2 focus:ring-primary/30 ${className ?? ""}`}
        {...inputProps}
      />
    </div>
  );
}
