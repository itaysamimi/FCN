"use client";

import { useActionState, useState, type FormEvent } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { bytesToGb, formatNumber, formatUsd } from "@/lib/format";
import { updateStorageLimit } from "./actions";

export type StorageOverview = {
  usedBytes: number;
  storageLimitBytes: number;
  classA: { used: number; limit: number };
  classB: { used: number; limit: number };
  resetDate: string;
};

// R2 pricing (USD) and free tier, per decisions 13 and 14 in CLAUDE.md.
const FREE_STORAGE_GB = 10;
const PRICE_PER_GB_MONTH = 0.015;
const FREE_CLASS_A = 1_000_000;
const FREE_CLASS_B = 10_000_000;
const PRICE_PER_MILLION_A = 4.5;
const PRICE_PER_MILLION_B = 0.36;

type LimitKind = "storage_limit_gb" | "class_a_limit" | "class_b_limit";

const LIMITS: Record<
  LimitKind,
  { label: string; unit: string; min: number; freeTier: number; cost: (value: number) => number }
> = {
  storage_limit_gb: {
    label: "תקרת אחסון",
    unit: "GB",
    min: 1,
    freeTier: FREE_STORAGE_GB,
    cost: (gb) => Math.max(0, gb - FREE_STORAGE_GB) * PRICE_PER_GB_MONTH,
  },
  class_a_limit: {
    label: "תקרת פעולות Class A",
    unit: "פעולות",
    min: 0,
    freeTier: FREE_CLASS_A,
    cost: (ops) => (Math.max(0, ops - FREE_CLASS_A) / 1_000_000) * PRICE_PER_MILLION_A,
  },
  class_b_limit: {
    label: "תקרת פעולות Class B",
    unit: "פעולות",
    min: 0,
    freeTier: FREE_CLASS_B,
    cost: (ops) => (Math.max(0, ops - FREE_CLASS_B) / 1_000_000) * PRICE_PER_MILLION_B,
  },
};

function barColor(percent: number) {
  if (percent > 95) return "bg-danger";
  if (percent > 80) return "bg-warning";
  return "bg-primary";
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
  return (
    <div
      className="h-2.5 overflow-hidden rounded-full bg-surface-raised"
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full rounded-full ${barColor(percent)}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

function LimitForm({ kind, current }: { kind: LimitKind; current: number }) {
  const config = LIMITS[kind];
  const [state, formAction] = useActionState(updateStorageLimit, initialFormState);
  const [value, setValue] = useState(String(current));
  const numeric = Number(value);
  const cost = Number.isFinite(numeric) ? config.cost(numeric) : 0;

  const confirmAboveFreeTier = (event: FormEvent<HTMLFormElement>) => {
    if (!Number.isFinite(numeric) || numeric <= config.freeTier || numeric === current) {
      return;
    }
    const message =
      kind === "storage_limit_gb"
        ? `תקרה מעל ${FREE_STORAGE_GB}GB חורגת מהמסלול החינמי של Cloudflare R2.\n` +
          `כשהאחסון יעבור את ${FREE_STORAGE_GB}GB, Cloudflare תחייב את כרטיס האשראי שבחשבון.\n` +
          `עלות משוערת אם התקרה תתמלא: ${formatUsd(cost)} לחודש.\n\nלשמור?`
        : `תקרה מעל ${formatNumber(config.freeTier)} פעולות חורגת מהמסלול החינמי של Cloudflare R2.\n` +
          `פעולות מעבר למסלול החינמי יחויבו בכרטיס האשראי שבחשבון.\n` +
          `עלות משוערת אם התקרה תתמלא: ${formatUsd(cost)} לחודש.\n\nלשמור?`;
    if (!window.confirm(message)) {
      event.preventDefault();
    }
  };

  return (
    <form action={formAction} onSubmit={confirmAboveFreeTier} className="flex flex-col gap-2">
      <input type="hidden" name="field" value={kind} />
      <label htmlFor={kind} className="text-sm text-text-muted">
        {config.label} ({config.unit})
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={kind}
          name="value"
          type="number"
          inputMode="numeric"
          dir="ltr"
          min={config.min}
          step={1}
          required
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="h-11 w-40 rounded-xl border border-border bg-surface-raised px-3 text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
        <SubmitButton pendingText="שומר…" variant="secondary">
          שמירה
        </SubmitButton>
        {state.message && (
          <span className={`text-sm ${state.status === "error" ? "text-danger" : "text-accent"}`}>
            {state.message}
          </span>
        )}
      </div>
      <p className={`text-xs ${cost > 0 ? "text-warning" : "text-text-muted"}`}>
        {cost > 0
          ? `מעל המסלול החינמי: עלות משוערת עד ${formatUsd(cost)} לחודש`
          : "בתוך המסלול החינמי, ללא עלות"}
      </p>
    </form>
  );
}

export function StorageCard({ overview }: { overview: StorageOverview }) {
  const { usedBytes, storageLimitBytes, classA, classB, resetDate } = overview;
  const storagePercent = storageLimitBytes > 0 ? (usedBytes / storageLimitBytes) * 100 : 100;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <h2 className="mb-5 text-lg font-medium text-text">אחסון</h2>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="text-text">שטח בשימוש</span>
          <span className="text-text-muted" dir="ltr">
            {bytesToGb(usedBytes).toFixed(2)} / {bytesToGb(storageLimitBytes).toFixed(2)} GB (
            {storagePercent.toFixed(1)}%)
          </span>
        </div>
        <UsageBar used={usedBytes} limit={storageLimitBytes} />
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <h3 className="text-sm font-medium text-text">פעולות החודש</h3>
        {[
          { name: "Class A (העלאות)", ...classA },
          { name: "Class B (צפייה והורדה)", ...classB },
        ].map((row) => (
          <div key={row.name} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="text-text">{row.name}</span>
              <span className="text-text-muted">
                {formatNumber(row.used)} מתוך {formatNumber(row.limit)}
              </span>
            </div>
            <UsageBar used={row.used} limit={row.limit} />
          </div>
        ))}
        <p className="text-xs text-text-muted">הספירה מתאפסת ב-{resetDate}</p>
      </div>

      <div className="mt-6 grid gap-5 border-t border-border pt-5">
        <LimitForm kind="storage_limit_gb" current={Math.round(bytesToGb(storageLimitBytes))} />
        <LimitForm kind="class_a_limit" current={classA.limit} />
        <LimitForm kind="class_b_limit" current={classB.limit} />
      </div>
    </section>
  );
}
