import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
      <p dir="ltr" className="text-6xl font-bold text-primary">
        404
      </p>
      <h1 className="text-xl text-text">הדף לא נמצא</h1>
      <Link
        href="/"
        className="inline-flex h-11 items-center rounded-xl border border-border bg-surface px-5 text-accent transition hover:border-primary"
      >
        חזרה לדף הבית
      </Link>
    </main>
  );
}
