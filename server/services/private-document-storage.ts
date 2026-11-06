import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
const DEFAULT_BUCKET = "kyc-documents";
let supabaseClient: SupabaseClient | null = null;
let bucketReady: Promise<void> | null = null;

function getStorageConfig() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const bucket = String(process.env.SUPABASE_KYC_BUCKET || DEFAULT_BUCKET).trim();
  return { url, serviceKey, bucket };
}

function getSupabase(): SupabaseClient | null {
  const { url, serviceKey } = getStorageConfig();
  if (!url || !serviceKey) return null;
  if (!supabaseClient) {
    supabaseClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return supabaseClient;
}

async function ensurePrivateBucket(client: SupabaseClient): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { bucket } = getStorageConfig();
      const listed = await client.storage.listBuckets();
      if (listed.error) throw listed.error;
      if (!listed.data.some(item => item.name === bucket)) {
        const created = await client.storage.createBucket(bucket, {
          public: false,
          fileSizeLimit: "5MB",
          allowedMimeTypes: [...ALLOWED_MIME_TYPES],
        });
        if (created.error) throw created.error;
      }
    })().catch(error => {
      bucketReady = null;
      throw error;
    });
  }
  await bucketReady;
}

export function validatePrivateDocument(file: { buffer: Buffer; mimetype: string; originalname: string }): string {
  const mime = String(file.mimetype || "").toLowerCase();
  const extension = path.extname(String(file.originalname || "")).toLowerCase();
  const signature = file.buffer.subarray(0, 8);
  const validJpeg = mime === "image/jpeg" && [".jpg", ".jpeg"].includes(extension) &&
    signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
  const validPng = mime === "image/png" && extension === ".png" &&
    signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const validPdf = mime === "application/pdf" && extension === ".pdf" &&
    signature.subarray(0, 5).toString("ascii") === "%PDF-";
  if (!validJpeg && !validPng && !validPdf) {
    throw new Error("DOCUMENT_CONTENT_TYPE_MISMATCH: envie um JPEG, PNG ou PDF válido.");
  }
  return mime;
}

export async function storePrivateDocument(
  userId: string,
  file: { buffer: Buffer; mimetype: string; originalname: string }
): Promise<string> {
  const mime = validatePrivateDocument(file);
  const extension = path.extname(file.originalname).toLowerCase();
  const objectName = `${randomUUID()}${extension}`;
  const client = getSupabase();

  if (client) {
    await ensurePrivateBucket(client);
    const { bucket } = getStorageConfig();
    const objectPath = `${userId}/${objectName}`;
    const result = await client.storage.from(bucket).upload(objectPath, file.buffer, {
      contentType: mime,
      cacheControl: "0",
      upsert: false,
    });
    if (result.error) throw result.error;
    return `supabase://${bucket}/${objectPath}`;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("PRIVATE_DOCUMENT_STORAGE_NOT_CONFIGURED: configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before accepting KYC files.");
  }
  const directory = path.resolve(process.env.DOCUMENT_UPLOAD_DIR || path.join(process.cwd(), "uploads", "documents"));
  await mkdir(directory, { recursive: true });
  const destination = path.resolve(directory, `${userId}-${objectName}`);
  await writeFile(destination, file.buffer, { flag: "wx", mode: 0o600 });
  return `local://${destination}`;
}

export async function readPrivateDocument(reference: string): Promise<{ buffer: Buffer; contentType: string }> {
  if (reference.startsWith("supabase://")) {
    const client = getSupabase();
    if (!client) throw new Error("PRIVATE_DOCUMENT_STORAGE_NOT_CONFIGURED");
    const [, remainder] = reference.split("supabase://");
    const separator = remainder.indexOf("/");
    if (separator < 1) throw new Error("INVALID_PRIVATE_DOCUMENT_REFERENCE");
    const bucket = remainder.slice(0, separator);
    const objectPath = remainder.slice(separator + 1);
    if (bucket !== getStorageConfig().bucket || !objectPath || objectPath.startsWith("/") || objectPath.split("/").includes("..")) {
      throw new Error("INVALID_PRIVATE_DOCUMENT_REFERENCE");
    }
    const { data, error } = await client.storage.from(bucket).download(objectPath);
    if (error || !data) throw error || new Error("DOCUMENT_NOT_FOUND");
    const buffer = Buffer.from(await data.arrayBuffer());
    const contentType = validatePrivateDocument({
      buffer,
      mimetype: data.type || "application/octet-stream",
      originalname: objectPath,
    });
    return { buffer, contentType };
  }

  const localPath = reference.startsWith("local://") ? reference.slice("local://".length) : reference;
  const directory = path.resolve(process.env.DOCUMENT_UPLOAD_DIR || path.join(process.cwd(), "uploads", "documents"));
  const resolved = path.resolve(localPath);
  const relative = path.relative(directory, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("DOCUMENT_PATH_OUTSIDE_PRIVATE_DIRECTORY");
  const buffer = await readFile(resolved);
  const extension = path.extname(resolved).toLowerCase();
  const contentType = extension === ".pdf" ? "application/pdf" :
    extension === ".png" ? "image/png" :
    extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "";
  if (!contentType) throw new Error("UNSUPPORTED_DOCUMENT_FORMAT");
  validatePrivateDocument({ buffer, mimetype: contentType, originalname: resolved });
  return { buffer, contentType };
}

export async function deletePrivateDocument(reference: string): Promise<void> {
  if (reference.startsWith("supabase://")) {
    const client = getSupabase();
    if (!client) return;
    const remainder = reference.slice("supabase://".length);
    const separator = remainder.indexOf("/");
    if (separator < 1) return;
    const bucket = remainder.slice(0, separator);
    const objectPath = remainder.slice(separator + 1);
    if (bucket !== getStorageConfig().bucket || objectPath.split("/").includes("..")) return;
    const { error } = await client.storage.from(bucket).remove([objectPath]);
    if (error) throw error;
    return;
  }
  if (reference.startsWith("local://")) {
    const localPath = reference.slice("local://".length);
    const directory = path.resolve(process.env.DOCUMENT_UPLOAD_DIR || path.join(process.cwd(), "uploads", "documents"));
    const resolved = path.resolve(localPath);
    const relative = path.relative(directory, resolved);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) await unlink(resolved).catch(() => {});
  }
}
