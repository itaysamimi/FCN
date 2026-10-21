import { NextResponse, type NextRequest } from "next/server";
import { ApiError, consumeOps, errorResponse, readJson, requireUser } from "@/lib/api";
import { assertOwnKey, readFileMeta, readUploadId } from "@/lib/file-validation";
import { completeMultipartUpload, headObject } from "@/lib/r2/storage";
import { discardUpload, itemExistsForKey } from "@/lib/upload-cleanup";
import { planMultipart, SINGLE_UPLOAD_MAX_BYTES } from "@/lib/upload-plan";
import type { FileItem } from "@/types/files";

const ITEM_COLUMNS = "id, owner_id, title, kind, workspace, size_bytes, mime_type, created_at";

function readParts(value: unknown, partCount: number) {
  if (!Array.isArray(value) || value.length !== partCount) {
    throw new ApiError(400, "invalid_parts", "חסרים חלקים בהעלאה");
  }
  const seen = new Set<number>();
  return value.map((part) => {
    const { partNumber, etag } = (part ?? {}) as { partNumber?: unknown; etag?: unknown };
    if (
      typeof partNumber !== "number" ||
      !Number.isInteger(partNumber) ||
      partNumber < 1 ||
      partNumber > partCount ||
      seen.has(partNumber) ||
      typeof etag !== "string" ||
      !etag ||
      etag.length > 200
    ) {
      throw new ApiError(400, "invalid_parts", "חסרים חלקים בהעלאה");
    }
    seen.add(partNumber);
    return { partNumber, etag };
  });
}

// Finishes an upload: assembles multipart parts, verifies the stored size
// against the reservation, creates the item row, and releases the reservation.
export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = await readJson(request);
    const key = assertOwnKey(body.key, user.id);
    const meta = readFileMeta(body);

    const { data: reserved, error: reservedError } = await supabase.rpc("pending_upload_size", {
      p_storage_key: key,
    });
    if (reservedError) {
      throw reservedError;
    }
    if (typeof reserved !== "number") {
      if (await itemExistsForKey(supabase, key)) {
        throw new ApiError(409, "already_completed", "הקובץ כבר נשמר");
      }
      const uploadId = typeof body.uploadId === "string" ? body.uploadId : null;
      await discardUpload(supabase, key, uploadId);
      throw new ApiError(410, "upload_expired", "ההעלאה לא נמצאה או שפג תוקפה. נסה להעלות שוב.");
    }

    if (reserved > SINGLE_UPLOAD_MAX_BYTES) {
      const uploadId = readUploadId(body.uploadId);
      const parts = readParts(body.parts, planMultipart(reserved).partCount);
      await consumeOps(supabase, "a", 1);
      try {
        await completeMultipartUpload(key, uploadId, parts);
      } catch (error) {
        console.error("CompleteMultipartUpload failed:", error);
        throw new ApiError(400, "upload_incomplete", "ההעלאה לא הושלמה. נסה להעלות שוב.");
      }
    }

    await consumeOps(supabase, "b", 1);
    const stored = await headObject(key);
    if (!stored) {
      throw new ApiError(400, "upload_missing", "הקובץ לא הגיע לאחסון. נסה להעלות שוב.");
    }
    if (stored.size !== reserved) {
      await discardUpload(supabase, key);
      throw new ApiError(400, "size_mismatch", "גודל הקובץ שהתקבל לא תואם. נסה להעלות שוב.");
    }

    const mimeType = stored.contentType || "application/octet-stream";
    const { data: item, error: insertError } = await supabase
      .from("items")
      .insert({
        owner_id: user.id,
        workspace: meta.workspace,
        kind: mimeType.startsWith("image/") ? "image" : "file",
        folder_id: meta.folderId,
        title: meta.name,
        storage_key: key,
        mime_type: mimeType,
        size_bytes: stored.size,
      })
      .select(ITEM_COLUMNS)
      .single<FileItem>();

    if (insertError || !item) {
      await discardUpload(supabase, key);
      console.error("Item insert failed:", insertError);
      throw new ApiError(
        400,
        "save_failed",
        insertError?.code === "23514"
          ? "התיקייה לא מתאימה לאזור שנבחר"
          : "לא הצלחנו לשמור את הקובץ. נסה שוב.",
      );
    }

    await supabase.rpc("release_upload", { p_storage_key: key });
    return NextResponse.json({ item });
  } catch (error) {
    return errorResponse(error);
  }
}
