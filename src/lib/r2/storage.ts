import "server-only";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getBucket, getR2Client } from "./client";

export const UPLOAD_URL_TTL_SECONDS = 10 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

// The signed URL fixes Content-Type and Content-Length, so the browser cannot
// upload a different size than the one that was reserved.
export function presignPut(key: string, contentType: string, size: number) {
  return getSignedUrl(
    getR2Client(),
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      ContentType: contentType,
      ContentLength: size,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );
}

export async function createMultipartUpload(key: string, contentType: string) {
  const result = await getR2Client().send(
    new CreateMultipartUploadCommand({ Bucket: getBucket(), Key: key, ContentType: contentType }),
  );
  if (!result.UploadId) {
    throw new Error("R2 did not return an UploadId");
  }
  return result.UploadId;
}

export function presignUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  partSize: number,
) {
  return getSignedUrl(
    getR2Client(),
    new UploadPartCommand({
      Bucket: getBucket(),
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      ContentLength: partSize,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
) {
  await getR2Client().send(
    new CompleteMultipartUploadCommand({
      Bucket: getBucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: [...parts]
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
      },
    }),
  );
}

export async function abortMultipartUpload(key: string, uploadId: string) {
  try {
    await getR2Client().send(
      new AbortMultipartUploadCommand({ Bucket: getBucket(), Key: key, UploadId: uploadId }),
    );
  } catch (error) {
    // Already completed or aborted: nothing left to clean up.
    if ((error as { name?: string }).name !== "NoSuchUpload") {
      throw error;
    }
  }
}

// Returns null if the object does not exist.
export async function headObject(key: string) {
  try {
    const result = await getR2Client().send(
      new HeadObjectCommand({ Bucket: getBucket(), Key: key }),
    );
    return { size: result.ContentLength ?? 0, contentType: result.ContentType ?? "" };
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "NotFound" || name === "NoSuchKey") {
      return null;
    }
    throw error;
  }
}

export async function deleteObject(key: string) {
  // Deleting a missing key succeeds, so this is safe to retry.
  await getR2Client().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

// RFC 6266 / 5987: an ASCII fallback plus the real (e.g. Hebrew) name as UTF-8.
export function contentDisposition(mode: "inline" | "attachment", fileName: string) {
  const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "file";
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${mode}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export function presignGet(
  key: string,
  options: { mode: "inline" | "attachment"; fileName: string; contentType?: string },
) {
  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
      ResponseContentDisposition: contentDisposition(options.mode, options.fileName),
      ResponseContentType: options.contentType || undefined,
    }),
    { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
  );
}
