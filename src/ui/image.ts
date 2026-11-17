/** Screenshot intake: validates type and size, downsizes (the on-device model has an image token budget). */
export interface PreparedImage {
  mimeType: "image/jpeg" | "image/png";
  base64: string;
  previewUrl: string;
}

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_SIDE = 1280;

export class ImageRejectedError extends Error {}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if ((file.type !== "image/jpeg" && file.type !== "image/png") || file.size > MAX_BYTES) {
    throw new ImageRejectedError("unsupported");
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const hgt = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageRejectedError("canvas");
  ctx.drawImage(bitmap, 0, 0, w, hgt);
  bitmap.close();
  const mimeType = file.type as "image/jpeg" | "image/png";
  const dataUrl = canvas.toDataURL(mimeType, 0.9);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return { mimeType, base64, previewUrl: dataUrl };
}
