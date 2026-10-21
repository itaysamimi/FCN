import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, readJson, requireUser } from "@/lib/api";
import { assertOwnKey } from "@/lib/file-validation";
import { discardUpload, itemExistsForKey } from "@/lib/upload-cleanup";

// Cancels an upload: aborts the multipart upload, deletes any object that was
// written, and releases the reservation. Never touches a completed file.
export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = await readJson(request);
    const key = assertOwnKey(body.key, user.id);

    if (await itemExistsForKey(supabase, key)) {
      await supabase.rpc("release_upload", { p_storage_key: key });
      return NextResponse.json({ ok: true });
    }

    const uploadId =
      typeof body.uploadId === "string" && body.uploadId.length <= 1024 ? body.uploadId : null;
    await discardUpload(supabase, key, uploadId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
