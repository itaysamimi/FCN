export default function Home() {
  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-6">
      {/* Soft purple glow behind the logo */}
      <div
        aria-hidden
        className="pointer-events-none absolute size-[28rem] max-w-[90vw] rounded-full bg-primary-dark/25 blur-3xl"
      />

      <div className="relative flex flex-col items-center gap-4 text-center">
        <h1
          dir="ltr"
          className="text-7xl font-bold tracking-tight text-primary drop-shadow-[0_0_24px_var(--color-primary)] sm:text-8xl"
        >
          FCN
        </h1>
        <p className="text-lg text-text sm:text-xl">הענן המשפחתי שלנו</p>
        <span className="mt-2 rounded-full border border-border bg-surface px-4 py-1 text-sm text-accent">
          בקרוב
        </span>
      </div>
    </main>
  );
}
