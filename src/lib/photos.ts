// Browser-side photo prep: phones shoot 12 MP; the job sheet needs a 1600px JPEG.
// ponytail: canvas resize, no EXIF handling — iOS Safari already orients camera captures.

export const PHOTO_MAX_EDGE = 1600;

/** Resize an image file to ≤1600px on the long edge, JPEG 0.82. Falls back to the original on any failure. */
export async function prepPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Storage object path for a job photo. */
export const photoPath = (appointmentId: string, kind: "before" | "after") => `${appointmentId}/${kind}-${crypto.randomUUID()}.jpg`;
