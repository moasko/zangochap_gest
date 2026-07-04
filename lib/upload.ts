import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

/**
 * Cloudflare R2 Client Configuration
 */
const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

/**
 * Uploads an image to Cloudflare R2.
 * @param dataUrl Base64 data of the image
 * @param fileName Original filename
 * @param options format "jpeg" pour les medias WhatsApp (l'API Cloud refuse le WebP), "webp" (defaut) sinon
 * @returns The public URL of the uploaded image
 */
export async function uploadImage(dataUrl: string, fileName: string, options?: { format?: "webp" | "jpeg" }): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith("data:image")) {
    return dataUrl;
  }

  try {
    const base64Data = dataUrl.split(",")[1];
    const buffer = Buffer.from(base64Data, "base64");
    const format = options?.format || "webp";

    // Optimization with Sharp
    const resized = sharp(buffer).resize(1200, 1200, { fit: "inside", withoutEnlargement: true });
    const optimizedBuffer = format === "jpeg"
      ? await resized.jpeg({ quality: 85 }).toBuffer()
      : await resized.webp({ quality: 80 }).toBuffer();

    const timestamp = Date.now();
    const slugifiedName = fileName.toLowerCase()
      .replace(/[^a-z0-9.]/g, "-")
      .replace(/\.[^/.]+$/, ""); // Remove extension

    const finalFileName = `${timestamp}-${slugifiedName}.${format === "jpeg" ? "jpg" : "webp"}`;

    // Upload to R2
    const uploadParams = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: finalFileName,
      Body: optimizedBuffer,
      ContentType: format === "jpeg" ? "image/jpeg" : "image/webp",
    };

    console.log(`[R2_UPLOAD] Uploading to bucket: ${process.env.R2_BUCKET_NAME} as ${finalFileName}`);
    await r2Client.send(new PutObjectCommand(uploadParams));
    
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${finalFileName}`;
    console.log(`[R2_UPLOAD] Success: ${publicUrl}`);

    return publicUrl;
  } catch (error: any) {
    console.error("[R2_UPLOAD] Error:", error);
    throw new Error(`Erreur d'upload Cloudflare R2: ${error.message || "Erreur inconnue"}`);
  }
}

// Keep the old function for local fallback if needed, but R2 is preferred now.
export function getUploadDir(): string {
  return ""; // Not needed for R2 but kept for API compatibility during transition
}

/**
 * Supprime une image de Cloudflare R2.
 * @param url URL complète de l'image ou nom du fichier (Key)
 */
export async function deleteImageFromR2(url: string): Promise<boolean> {
  if (!url) return false;

  try {
    // Extraire la clé (Key) de l'URL si nécessaire
    let key = url;
    if (url.startsWith('http')) {
      const publicUrl = process.env.R2_PUBLIC_URL || '';
      key = url.replace(publicUrl + '/', '');
    }

    const deleteParams = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    };

    console.log(`[R2_DELETE] Deleting from bucket: ${process.env.R2_BUCKET_NAME}, key: ${key}`);
    await r2Client.send(new DeleteObjectCommand(deleteParams));
    return true;
  } catch (error) {
    console.error("[R2_DELETE] Error:", error);
    return false;
  }
}
