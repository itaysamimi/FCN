import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { FamilyMember } from "@/types/auth";
import { InviteForm } from "./invite-form";
import { ResendInviteButton } from "./resend-invite-button";
import { StorageCard, type StorageOverview } from "./storage-card";

export const metadata: Metadata = {
  title: "ניהול משפחה | FCN",
};

// Block on the server instead of streaming, so the admin check runs before any
// output and a non-admin gets a real 404 status.
export const instant = false;

async function getFamilyMembers(): Promise<FamilyMember[]> {
  const supabase = await createClient();
  const [{ data: profiles, error: profilesError }, { data: usersData, error: usersError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, is_admin")
        .order("created_at")
        .returns<{ id: string; display_name: string; is_admin: boolean }[]>(),
      createAdminClient().auth.admin.listUsers({ perPage: 1000 }),
    ]);

  if (profilesError || usersError) {
    throw new Error("Failed to load family members");
  }

  const usersById = new Map(usersData.users.map((user) => [user.id, user]));
  return (profiles ?? []).map((profile) => {
    const authUser = usersById.get(profile.id);
    return {
      id: profile.id,
      displayName: profile.display_name,
      email: authUser?.email ?? "",
      isAdmin: profile.is_admin,
      // Invited users get email_confirmed_at once they open the invite link.
      status: authUser?.email_confirmed_at ? "active" : "pending",
    };
  });
}

// Read with the admin's own client: RLS lets admins read r2_usage, and
// storage_used_bytes() is callable by any signed-in user.
async function getStorageOverview(): Promise<StorageOverview> {
  const supabase = await createClient();
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [settingsResult, usedResult, usageResult] = await Promise.all([
    supabase
      .from("app_settings")
      .select("storage_limit_bytes, class_a_limit, class_b_limit")
      .eq("id", 1)
      .single<{ storage_limit_bytes: number; class_a_limit: number; class_b_limit: number }>(),
    supabase.rpc("storage_used_bytes"),
    supabase
      .from("r2_usage")
      .select("class_a, class_b")
      .eq("month", month)
      .maybeSingle<{ class_a: number; class_b: number }>(),
  ]);
  if (settingsResult.error || usedResult.error || usageResult.error) {
    throw new Error("Failed to load storage overview");
  }

  const settings = settingsResult.data;
  return {
    usedBytes: Number(usedResult.data ?? 0),
    storageLimitBytes: Number(settings.storage_limit_bytes),
    classA: { used: Number(usageResult.data?.class_a ?? 0), limit: Number(settings.class_a_limit) },
    classB: { used: Number(usageResult.data?.class_b ?? 0), limit: Number(settings.class_b_limit) },
    resetDate: new Intl.DateTimeFormat("he-IL", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(nextMonth),
  };
}

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user?.isAdmin) {
    notFound();
  }

  const [members, storage] = await Promise.all([getFamilyMembers(), getStorageOverview()]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:py-12">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-text">ניהול משפחה</h1>
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-xl px-3 text-sm text-accent hover:text-text"
        >
          חזרה לדף הבית
        </Link>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="mb-1 text-lg font-medium text-text">הזמנת בן משפחה</h2>
        <p className="mb-5 text-sm text-text-muted">
          המוזמן יקבל מייל עם קישור לבחירת סיסמה.
        </p>
        <InviteForm />
      </section>

      <StorageCard overview={storage} />

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="mb-4 text-lg font-medium text-text">
          בני המשפחה <span className="text-sm text-text-muted">({members.length})</span>
        </h2>
        <ul className="flex flex-col divide-y divide-border">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium text-text">{member.displayName}</p>
                {/* LTR email; text-end keeps it aligned with the RTL name above. */}
                <p dir="ltr" className="truncate text-end text-sm text-text-muted">
                  {member.email}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-text-muted">מנהל: {member.isAdmin ? "כן" : "לא"}</span>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs ${
                    member.status === "active"
                      ? "bg-primary/15 text-accent"
                      : "bg-surface-raised text-text-muted"
                  }`}
                >
                  {member.status === "active" ? "פעיל" : "ממתין להצטרפות"}
                </span>
                {member.status === "pending" && <ResendInviteButton userId={member.id} />}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
