"use client";

// TEMPORARY test page component (step 4). Will be removed in step 7.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatBytes } from "@/lib/format";
import type { ApiErrorBody, FileItem } from "@/types/files";

async function fetchFileUrl(id: string, mode: "view" | "download") {
  const response = await fetch(`/api/files/${id}/url?mode=${mode}`);
  const data = (await response.json()) as { url: string } | ApiErrorBody;
  if (!response.ok || !("url" in data)) {
    throw new Error("error" in data ? data.error.message : "משהו השתבש");
  }
  return data.url;
}

function Thumbnail({ id, title }: { id: string; title: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetchFileUrl(id, "view")
      .then((signed) => active && setUrl(signed))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-surface-raised">
      {url && (
        // Signed, short-lived R2 URL: next/image optimization does not apply.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={title} className="size-full object-cover" />
      )}
    </div>
  );
}

export function FileRow({ item, isOwner }: { item: FileItem; isOwner: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "משהו השתבש");
    } finally {
      setBusy(false);
    }
  };

  const view = () =>
    run(async () => {
      // Open the tab synchronously so popup blockers allow it, then navigate.
      const tab = window.open("", "_blank");
      try {
        const url = await fetchFileUrl(item.id, "view");
        if (tab) {
          tab.location.href = url;
        } else {
          window.location.assign(url);
        }
      } catch (err) {
        tab?.close();
        throw err;
      }
    });

  const download = () =>
    run(async () => {
      window.location.assign(await fetchFileUrl(item.id, "download"));
    });

  const remove = () => {
    if (!window.confirm(`למחוק את "${item.title}"?`)) {
      return;
    }
    run(async () => {
      const response = await fetch(`/api/files/${item.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        throw new Error(data?.error.message ?? "המחיקה נכשלה");
      }
      router.refresh();
    });
  };

  const buttonClass =
    "h-11 rounded-xl border border-border px-3 text-sm text-text transition hover:border-primary disabled:opacity-50";

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {item.kind === "image" ? (
          <Thumbnail id={item.id} title={item.title} />
        ) : (
          <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-xs text-text-muted">
            קובץ
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-text">{item.title}</p>
          <p className="text-xs text-text-muted">
            {formatBytes(item.size_bytes)} · {item.kind === "image" ? "תמונה" : "קובץ"} ·{" "}
            {item.workspace === "personal" ? "אישי" : "משותף"}
            {item.mime_type && (
              <span dir="ltr" className="ms-1">
                ({item.mime_type})
              </span>
            )}
          </p>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={view} className={buttonClass}>
          צפייה
        </button>
        <button type="button" disabled={busy} onClick={download} className={buttonClass}>
          הורדה
        </button>
        {isOwner && (
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className={`${buttonClass} hover:border-danger hover:text-danger`}
          >
            מחיקה
          </button>
        )}
      </div>
    </li>
  );
}
