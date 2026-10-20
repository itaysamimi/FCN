import type { ReactNode } from "react";

type AuthCardProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

// Centered card with the FCN logo, used by the sign-in and password pages.
export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p
          dir="ltr"
          className="mb-6 text-center text-4xl font-bold tracking-tight text-primary drop-shadow-[0_0_18px_var(--color-primary)]"
        >
          FCN
        </p>
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-lg shadow-primary-dark/10 sm:p-8">
          <h1 className="text-xl font-semibold text-text">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
