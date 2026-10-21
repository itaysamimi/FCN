// How a file of a given size is uploaded. Shared by the server (which signs
// the URLs) and the browser (which slices the file), so both agree on parts.

const MB = 1024 * 1024;

export const SINGLE_UPLOAD_MAX_BYTES = 50 * MB;
export const MIN_PART_SIZE = 10 * MB;
export const MAX_PARTS = 10_000;
export const MAX_PARTS_PER_REQUEST = 100;

export function planMultipart(size: number) {
  // At least 10MB, rounded up to whole MB, and large enough for <= 10,000 parts.
  const partSize = Math.max(MIN_PART_SIZE, Math.ceil(size / MAX_PARTS / MB) * MB);
  return { partSize, partCount: Math.ceil(size / partSize) };
}

export function partLength(size: number, partSize: number, partNumber: number) {
  return Math.min(partSize, size - (partNumber - 1) * partSize);
}
