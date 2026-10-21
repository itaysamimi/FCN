// Browser-side upload logic: talks to /api/files/upload/* and sends the bytes
// straight to R2 with the presigned URLs. Reused by the files UI in step 7.

import { OPS_LIMIT_MESSAGE, STORAGE_FULL_MESSAGE } from "@/lib/storage-messages";
import { MAX_PARTS_PER_REQUEST } from "@/lib/upload-plan";
import type { ApiErrorBody, FileItem, StartUploadResponse, Workspace } from "@/types/files";

const PART_CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;
// Part URLs are signed in small batches, just before they are needed, so they
// do not expire (10 minutes) while earlier parts are still uploading.
const PART_URL_BATCH = Math.min(8, MAX_PARTS_PER_REQUEST);
const PART_URL_MAX_AGE_MS = 8 * 60 * 1000;

const MESSAGES: Record<string, string> = {
  storage_full: STORAGE_FULL_MESSAGE,
  ops_limit: OPS_LIMIT_MESSAGE,
  cancelled: "ההעלאה בוטלה",
  network: "בעיית תקשורת. בדוק את החיבור ונסה שוב.",
  upload_failed: "העלאת הקובץ נכשלה. נסה שוב.",
};

export class UploadError extends Error {
  constructor(
    public code: string,
    message = MESSAGES[code] ?? MESSAGES.upload_failed,
    // Transfer errors (network, R2 status) may succeed on retry; API refusals will not.
    public retryable = false,
  ) {
    super(message);
  }
}

export type UploadOptions = {
  workspace: Workspace;
  folderId?: string | null;
  onProgress?: (percent: number) => void;
};

export type UploadHandle = {
  promise: Promise<FileItem>;
  cancel: () => void;
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new UploadError("network", MESSAGES.network, true);
  }
  const data = (await response.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!response.ok) {
    const error = (data as ApiErrorBody | null)?.error;
    const code = error?.code ?? "server_error";
    throw new UploadError(code, MESSAGES[code] ?? error?.message ?? MESSAGES.upload_failed);
  }
  return data as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function startUpload(file: File, options: UploadOptions): UploadHandle {
  const activeRequests = new Set<XMLHttpRequest>();
  let stopped = false;
  let cancelled = false;

  const stop = () => {
    stopped = true;
    activeRequests.forEach((xhr) => xhr.abort());
  };

  // PUTs a blob to a presigned URL with progress; resolves with the ETag.
  const putBlob = (url: string, blob: Blob, contentType: string | null, onLoaded: (bytes: number) => void) =>
    new Promise<string | null>((resolve, reject) => {
      if (stopped) {
        reject(new UploadError("cancelled"));
        return;
      }
      const xhr = new XMLHttpRequest();
      activeRequests.add(xhr);
      xhr.open("PUT", url);
      if (contentType) {
        xhr.setRequestHeader("Content-Type", contentType);
      }
      xhr.upload.onprogress = (event) => onLoaded(event.loaded);
      xhr.onload = () => {
        activeRequests.delete(xhr);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.getResponseHeader("ETag"));
        } else {
          reject(new UploadError("upload_failed", MESSAGES.upload_failed, true));
        }
      };
      xhr.onerror = () => {
        activeRequests.delete(xhr);
        reject(new UploadError("network", MESSAGES.network, true));
      };
      xhr.onabort = () => {
        activeRequests.delete(xhr);
        reject(new UploadError("cancelled"));
      };
      xhr.send(blob);
    });

  let lastPercent = -1;
  const reportProgress = (loadedBytes: number) => {
    // Capped at 99 until the server confirms the file is saved.
    const percent = Math.min(99, Math.floor((loadedBytes / file.size) * 100));
    if (percent !== lastPercent) {
      lastPercent = percent;
      options.onProgress?.(percent);
    }
  };

  const uploadParts = async (session: Extract<StartUploadResponse, { mode: "multipart" }>) => {
    const { key, uploadId, partSize, partCount } = session;
    const loaded = new Array<number>(partCount + 1).fill(0);
    const etags: { partNumber: number; etag: string }[] = [];
    const batches = new Map<number, { signedAt: number; urls: Promise<Map<number, string>> }>();

    const signParts = async (from: number, to: number) => {
      const { parts } = await postJson<{ parts: { partNumber: number; url: string }[] }>(
        "/api/files/upload/parts",
        { key, uploadId, from, to },
      );
      return new Map(parts.map((part) => [part.partNumber, part.url]));
    };

    const partUrl = async (partNumber: number, fresh: boolean) => {
      if (fresh) {
        return (await signParts(partNumber, partNumber)).get(partNumber)!;
      }
      const batch = Math.floor((partNumber - 1) / PART_URL_BATCH);
      let entry = batches.get(batch);
      if (!entry || Date.now() - entry.signedAt > PART_URL_MAX_AGE_MS) {
        const from = batch * PART_URL_BATCH + 1;
        const to = Math.min(partCount, from + PART_URL_BATCH - 1);
        entry = { signedAt: Date.now(), urls: signParts(from, to) };
        batches.set(batch, entry);
        entry.urls.catch(() => batches.delete(batch));
      }
      return (await entry.urls).get(partNumber)!;
    };

    let nextPart = 1;
    const worker = async () => {
      while (!stopped) {
        const partNumber = nextPart++;
        if (partNumber > partCount) {
          return;
        }
        const start = (partNumber - 1) * partSize;
        const blob = file.slice(start, Math.min(start + partSize, file.size));

        for (let attempt = 1; ; attempt++) {
          try {
            const url = await partUrl(partNumber, attempt > 1);
            const etag = await putBlob(url, blob, null, (bytes) => {
              loaded[partNumber] = bytes;
              reportProgress(loaded.reduce((sum, value) => sum + value, 0));
            });
            if (!etag) {
              throw new UploadError("upload_failed", MESSAGES.upload_failed, true);
            }
            etags.push({ partNumber, etag });
            break;
          } catch (error) {
            loaded[partNumber] = 0;
            const retryable = error instanceof UploadError && error.retryable;
            if (stopped || !retryable || attempt >= MAX_ATTEMPTS) {
              throw error;
            }
            await sleep(1000 * attempt);
          }
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, partCount) }, worker));
    } catch (error) {
      stop();
      throw error;
    }
    return etags;
  };

  const promise = (async () => {
    // Not cancellable mid-request: if the server reserved space, we need the
    // key to release it, so we wait for the answer and abort right after.
    const session = await postJson<StartUploadResponse>("/api/files/upload/start", {
      name: file.name,
      size: file.size,
      type: file.type,
      workspace: options.workspace,
      folder_id: options.folderId ?? null,
    });
    const uploadId = session.mode === "multipart" ? session.uploadId : undefined;

    try {
      if (cancelled) {
        throw new UploadError("cancelled");
      }
      options.onProgress?.(0);

      let parts: { partNumber: number; etag: string }[] | undefined;
      if (session.mode === "single") {
        await putBlob(session.url, file, session.contentType, reportProgress);
      } else {
        parts = await uploadParts(session);
      }

      const { item } = await postJson<{ item: FileItem }>("/api/files/upload/complete", {
        key: session.key,
        uploadId,
        parts,
        name: file.name,
        workspace: options.workspace,
        folder_id: options.folderId ?? null,
      });
      options.onProgress?.(100);
      return item;
    } catch (error) {
      stop();
      // Best effort; the server never deletes a file that was already saved.
      postJson("/api/files/upload/abort", { key: session.key, uploadId }).catch(() => {});
      if (cancelled) {
        throw new UploadError("cancelled");
      }
      throw error instanceof UploadError ? error : new UploadError("upload_failed");
    }
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      stop();
    },
  };
}
