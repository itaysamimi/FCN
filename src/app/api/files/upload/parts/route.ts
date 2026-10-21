import { NextResponse, type NextRequest } from "next/server";
import { ApiError, consumeOps, errorResponse, readJson, requireUser } from "@/lib/api";
import { assertOwnKey, readUploadId } from "@/lib/file-validation";
import { presignUploadPart } from "@/lib/r2/storage";
import { MAX_PARTS_PER_REQUEST, partLength, planMultipart } from "@/lib/upload-plan";

// Signs PUT URLs for a range of parts (up to 100). Each URL fixes the exact
// part length, computed from the reserved size, never from the client.
export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = await readJson(request);
    const key = assertOwnKey(body.key, user.id);
    const uploadId = readUploadId(body.uploadId);

    // Also extends the reservation, so long uploads do not expire midway.
    const { data: reserved, error } = await supabase.rpc("pending_upload_size", {
      p_storage_key: key,
      p_extend: true,
    });
    if (error) {
      throw error;
    }
    if (typeof reserved !== "number") {
      throw new ApiError(410, "upload_expired", "ההעלאה לא נמצאה או שפג תוקפה. נסה להעלות שוב.");
    }

    const { partSize, partCount } = planMultipart(reserved);
    const from = body.from;
    const to = body.to;
    if (
      typeof from !== "number" ||
      typeof to !== "number" ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 1 ||
      to > partCount ||
      from > to ||
      to - from + 1 > MAX_PARTS_PER_REQUEST
    ) {
      throw new ApiError(400, "invalid_parts", "טווח החלקים לא תקין");
    }

    await consumeOps(supabase, "a", to - from + 1);

    const parts = await Promise.all(
      Array.from({ length: to - from + 1 }, async (_, index) => {
        const partNumber = from + index;
        const url = await presignUploadPart(
          key,
          uploadId,
          partNumber,
          partLength(reserved, partSize, partNumber),
        );
        return { partNumber, url };
      }),
    );
    return NextResponse.json({ parts });
  } catch (error) {
    return errorResponse(error);
  }
}
