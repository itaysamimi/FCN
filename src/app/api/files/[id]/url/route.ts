import { NextResponse, type NextRequest } from "next/server";
import { ApiError, consumeOps, errorResponse, requireUser } from "@/lib/api";
import { isUuid } from "@/lib/file-validation";
import { presignGet } from "@/lib/r2/storage";

const NOT_FOUND = new ApiError(404, "not_found", "הקובץ לא נמצא");

// Returns a short-lived GET URL for a file the user can see (RLS decides).
export async function GET(request: NextRequest, { params }: RouteContext<"/api/files/[id]/url">) {
  try {
    const { supabase } = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) {
      throw NOT_FOUND;
    }
    const mode = request.nextUrl.searchParams.get("mode") === "download" ? "attachment" : "inline";

    const { data: item, error } = await supabase
      .from("items")
      .select("title, kind, storage_key, mime_type")
      .eq("id", id)
      .maybeSingle<{ title: string; kind: string; storage_key: string | null; mime_type: string | null }>();
    if (error) {
      throw error;
    }
    if (!item || item.kind === "note" || !item.storage_key) {
      throw NOT_FOUND;
    }

    await consumeOps(supabase, "b", 1);
    const url = await presignGet(item.storage_key, {
      mode,
      fileName: item.title,
      contentType: item.mime_type ?? undefined,
    });
    return NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
