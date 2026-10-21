import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api";
import type { Workspace } from "@/types/files";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_PATTERN = /^[\w.+-]+\/[\w.+-]+$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

// Storage keys are always "<owner id>/<random uuid>": no file names, and
// the prefix proves ownership.
export function assertOwnKey(key: unknown, userId: string): string {
  if (typeof key !== "string" || !key.startsWith(`${userId}/`) || !isUuid(key.slice(37))) {
    throw new ApiError(403, "forbidden", "אין לך הרשאה לקובץ הזה");
  }
  return key;
}

export function readUploadId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 1024) {
    throw new ApiError(400, "bad_request", "בקשה לא תקינה");
  }
  return value;
}

export function readContentType(value: unknown) {
  const type = typeof value === "string" ? value.trim().toLowerCase() : "";
  return type.length <= 127 && MIME_PATTERN.test(type) ? type : "application/octet-stream";
}

export type FileMeta = { name: string; workspace: Workspace; folderId: string | null };

export function readFileMeta(body: Record<string, unknown>): FileMeta {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 200) {
    throw new ApiError(400, "invalid_name", "שם הקובץ צריך להיות באורך 1 עד 200 תווים");
  }
  if (body.workspace !== "personal" && body.workspace !== "shared") {
    throw new ApiError(400, "invalid_workspace", "יש לבחור אזור: אישי או משותף");
  }
  const folderId = body.folder_id ?? null;
  if (folderId !== null && !isUuid(folderId)) {
    throw new ApiError(400, "invalid_folder", "התיקייה לא תקינה");
  }
  return { name, workspace: body.workspace, folderId };
}

// The folder must exist, be visible to the user (RLS), be in the same
// workspace, and if personal, belong to the user.
export async function assertFolderUsable(
  supabase: SupabaseClient,
  meta: FileMeta,
  userId: string,
) {
  if (!meta.folderId) {
    return;
  }
  const { data: folder, error } = await supabase
    .from("folders")
    .select("id, workspace, owner_id")
    .eq("id", meta.folderId)
    .maybeSingle<{ id: string; workspace: Workspace; owner_id: string }>();
  if (error) {
    throw error;
  }
  if (!folder) {
    throw new ApiError(404, "folder_not_found", "התיקייה לא נמצאה");
  }
  if (folder.workspace !== meta.workspace) {
    throw new ApiError(400, "folder_workspace_mismatch", "התיקייה שייכת לאזור אחר");
  }
  if (folder.workspace === "personal" && folder.owner_id !== userId) {
    throw new ApiError(403, "forbidden", "אין לך הרשאה לתיקייה הזו");
  }
}
