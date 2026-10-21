"use client";

// TEMPORARY test page component (step 4). Will be removed in step 7.

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { formatBytes } from "@/lib/format";
import { startUpload, UploadError, type UploadHandle } from "@/lib/upload";
import type { Workspace } from "@/types/files";

type Row = {
  id: string;
  name: string;
  size: number;
  percent: number;
  status: "uploading" | "done" | "error" | "cancelled";
  message?: string;
};

export function Uploader() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace>("personal");
  const [rows, setRows] = useState<Row[]>([]);
  const handles = useRef(new Map<string, UploadHandle>());

  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const uploadFiles = (files: FileList | null) => {
    if (!files?.length) {
      return;
    }
    for (const file of Array.from(files)) {
      const id = crypto.randomUUID();
      setRows((current) => [
        { id, name: file.name, size: file.size, percent: 0, status: "uploading" },
        ...current,
      ]);
      const handle = startUpload(file, {
        workspace,
        onProgress: (percent) => updateRow(id, { percent }),
      });
      handles.current.set(id, handle);
      handle.promise
        .then(() => {
          updateRow(id, { status: "done", percent: 100 });
          router.refresh();
        })
        .catch((error: unknown) => {
          const cancelled = error instanceof UploadError && error.code === "cancelled";
          updateRow(id, {
            status: cancelled ? "cancelled" : "error",
            message: error instanceof Error ? error.message : "העלאת הקובץ נכשלה",
          });
        })
        .finally(() => handles.current.delete(id));
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <h2 className="mb-4 text-lg font-medium text-text">העלאה</h2>

      <fieldset className="mb-4 flex flex-wrap gap-2">
        <legend className="mb-2 text-sm text-text-muted">אזור</legend>
        {(["personal", "shared"] as const).map((value) => (
          <label
            key={value}
            className={`inline-flex h-11 cursor-pointer items-center rounded-xl border px-4 text-sm ${
              workspace === value ? "border-primary bg-primary/15 text-accent" : "border-border text-text-muted"
            }`}
          >
            <input
              type="radio"
              name="workspace"
              value={value}
              checked={workspace === value}
              onChange={() => setWorkspace(value)}
              className="sr-only"
            />
            {value === "personal" ? "אישי" : "משותף"}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <label className="inline-flex h-11 cursor-pointer items-center rounded-xl bg-primary px-5 font-medium text-text hover:bg-primary-dark">
          בחירת קבצים
          <input
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              uploadFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <label className="inline-flex h-11 cursor-pointer items-center rounded-xl border border-border bg-surface-raised px-5 text-text hover:border-primary">
          צילום
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) => {
              uploadFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      </div>

      {rows.length > 0 && (
        <ul className="mt-5 flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-border bg-surface-raised p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-text">{row.name}</p>
                  <p className="text-xs text-text-muted">
                    {formatBytes(row.size)} ·{" "}
                    {row.status === "uploading"
                      ? `${row.percent}%`
                      : row.status === "done"
                        ? "הועלה"
                        : row.message}
                  </p>
                </div>
                {row.status === "uploading" && (
                  <button
                    type="button"
                    onClick={() => handles.current.get(row.id)?.cancel()}
                    className="h-11 shrink-0 rounded-xl border border-border px-4 text-sm text-text hover:border-danger hover:text-danger"
                  >
                    ביטול
                  </button>
                )}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                <div
                  className={`h-full rounded-full transition-[width] ${
                    row.status === "error"
                      ? "bg-danger"
                      : row.status === "cancelled"
                        ? "bg-text-muted"
                        : "bg-primary"
                  }`}
                  style={{ width: `${row.percent}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
