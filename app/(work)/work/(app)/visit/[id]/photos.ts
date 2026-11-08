import { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE } from "../../../_lib/visit";

export type Prepared = { blob: Blob; type: string; ext: "jpg" | "png" | "webp" | "heic" };

const PASS_THROUGH: Record<string, Prepared["ext"]> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

/**
 * Shrinks a camera photo on the phone to a JPEG no bigger than 1600px on its longest side:
 * a fraction of the size to send in bad signal, viewable in any browser (HEIC isn't), and
 * EXIF (including GPS) is dropped by re-drawing. If the phone can't decode it, the original
 * goes as long as the bucket takes that type.
 */
export async function preparePhoto(file: File): Promise<Prepared | { error: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    if (blob && blob.size > 0) return { blob, type: "image/jpeg", ext: "jpg" };
  } catch {
    // fall through to the original file
  }
  const ext = PASS_THROUGH[file.type];
  if (!ext) return { error: "That isn't a photo Ping can take. Use the camera." };
  if (file.size > PHOTO_MAX_BYTES) return { error: "That photo is too big to send. Take it again with the camera." };
  if (file.size === 0) return { error: "That photo is empty. Take it again." };
  return { blob: file, type: file.type, ext };
}
