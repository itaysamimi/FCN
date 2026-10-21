import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, consumeOps, errorResponse, readJson, requireUser } from "@/lib/api";
import { assertFolderUsable, readContentType, readFileMeta } from "@/lib/file-validation";
import { createMultipartUpload, presignPut } from "@/lib/r2/storage";
import { STORAGE_FULL_MESSAGE } from "@/lib/storage-messages";
import { planMultipart, SINGLE_UPLOAD_MAX_BYTES } from "@/lib/upload-plan";
import type { StartUploadResponse } from "@/types/files";

// Route Handlers run on Node.js by default. With Cache Components enabled,
// Next.js does not allow an explicit `export const runtime`.

// Reserves space against the family cap, then returns either one presigned
// PUT (up to 50MB) or a multipart upload id and plan.
export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = await readJson(request);
    const meta = readFileMeta(body);
    const size = body.size;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) {
      throw new ApiError(400, "invalid_size", "גודל הקובץ לא תקין");
    }
    const contentType = readContentType(body.type);
    await assertFolderUsable(supabase, meta, user.id);

    const key = `${user.id}/${randomUUID()}`;
    const { error: reserveError } = await supabase.rpc("reserve_upload", {
      p_storage_key: key,
      p_size: size,
    });
    if (reserveError) {
      if (reserveError.message === "storage_full") {
        throw new ApiError(409, "storage_full", STORAGE_FULL_MESSAGE);
      }
      throw reserveError;
    }

    try {
      // One class A operation: the single PUT, or CreateMultipartUpload.
      await consumeOps(supabase, "a", 1);

      if (size <= SINGLE_UPLOAD_MAX_BYTES) {
        const url = await presignPut(key, contentType, size);
        return NextResponse.json<StartUploadResponse>({ mode: "single", key, contentType, url });
      }

      const uploadId = await createMultipartUpload(key, contentType);
      const { partSize, partCount } = planMultipart(size);
      return NextResponse.json<StartUploadResponse>({
        mode: "multipart",
        key,
        contentType,
        uploadId,
        partSize,
        partCount,
      });
    } catch (error) {
      await supabase.rpc("release_upload", { p_storage_key: key });
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
