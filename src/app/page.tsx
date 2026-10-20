import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { getCurrentUser } from "@/lib/auth";
import { signOut } from "./actions";

// Temporary home page until the app shell (step 5).
export default function Home() {
  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute size-[28rem] max-w-[90vw] rounded-full bg-primary-dark/25 blur-3xl"
      />

      <div className="relative flex flex-col items-center gap-6 text-center">
        <p
          dir="ltr"
          className="text-6xl font-bold tracking-tight text-primary drop-shadow-[0_0_24px_var(--color-primary)] sm:text-7xl"
        >
          FCN
        </p>
        <Suspense fallback={<p className="h-8 text-text-muted">טוען…</p>}>
          <Greeting />
        </Suspense>
      </div>
    </main>
  );
}

async function Greeting() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <>
      <h1 className="text-2xl font-semibold text-text">שלום, {user.displayName}</h1>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {user.isAdmin && (
          <Link
            href="/admin"
            className="inline-flex h-11 items-center rounded-xl border border-border bg-surface px-5 text-accent transition hover:border-primary"
          >
            ניהול משפחה
          </Link>
        )}
        <form action={signOut}>
          <SubmitButton pendingText="מתנתק…" variant="secondary">
            התנתקות
          </SubmitButton>
        </form>
      </div>
    </>
  );
}
