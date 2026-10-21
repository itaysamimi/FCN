import { NextResponse, type NextRequest } from "next/server";
import { ApiError, countCleanupOps, errorResponse, requireUser } from "@/lib/api";
import { isUuid } from "@/lib/file-validation";
import { deleteObject } from "@/lib/r2/storage";

// Deletes a file: owner only. R2 first, then the row, so a row never points
// at nothing for long and no object is left without a row.
export async function DELETE(_request: NextRequest, { params }: RouteContext<"/api/files/[id]">) {
  try {
    const { supabase, user } = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) {
      throw new ApiError(404, "not_found", "הקובץ לא נמצא");
    }

    const { data: item, error } = await supabase
      .from("items")
      .select("id, owner_id, kind, storage_key")
      .eq("id", id)
      .maybeSingle<{ id: string; owner_id: string; kind: string; storage_key: string | null }>();
    if (error) {
      throw error;
    }
    if (!item || item.kind === "note" || !item.storage_key) {
      throw new ApiError(404, "not_found", "הקובץ לא נמצא");
    }
    if (item.owner_id !== user.id) {
      throw new ApiError(403, "forbidden", "רק מי שהעלה את הקובץ יכול למחוק אותו");
    }

    await countCleanupOps(supabase);
    await deleteObject(item.storage_key);

    const { data: deleted, error: deleteError } = await supabase
      .from("items")
      .delete()
      .eq("id", id)
      .select("id");
    if (deleteError || !deleted?.length) {
      console.error("Item row delete failed after R2 delete:", deleteError);
      throw new ApiError(500, "delete_failed", "הקובץ נמחק מהאחסון אבל לא מהרשימה. נסה שוב.");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
