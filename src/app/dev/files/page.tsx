// TEMPORARY test page for R2 uploads (step 4). Will be removed in step 7,
// when the real files and images UI replaces it.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FileItem } from "@/types/files";
import { FileRow } from "./file-row";
import { Uploader } from "./uploader";

export const metadata: Metadata = {
  title: "בדיקת קבצים (זמני) | FCN",
};

export default function DevFilesPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-text">בדיקת קבצים</h1>
        <Link href="/" className="inline-flex h-11 items-center px-3 text-sm text-accent hover:text-text">
          חזרה לדף הבית
        </Link>
      </header>
      <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
        דף בדיקה זמני להעלאה והורדה מול האחסון. הוא יוסר בשלב 7, כשיגיע ממשק הקבצים האמיתי.
      </p>

      <Uploader />

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="mb-4 text-lg font-medium text-text">קבצים ותמונות</h2>
        <Suspense fallback={<p className="text-sm text-text-muted">טוען…</p>}>
          <FileList />
        </Suspense>
      </section>
    </main>
  );
}

async function FileList() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: items, error } = await supabase
    .from("items")
    .select("id, owner_id, title, kind, workspace, size_bytes, mime_type, created_at")
    .in("kind", ["image", "file"])
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<FileItem[]>();

  if (error) {
    return <p className="text-sm text-danger">לא הצלחנו לטעון את הרשימה</p>;
  }
  if (!items?.length) {
    return <p className="text-sm text-text-muted">עוד אין קבצים</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((item) => (
        <FileRow key={item.id} item={item} isOwner={item.owner_id === user.id} />
      ))}
    </ul>
  );
}
