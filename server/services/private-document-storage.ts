import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
const DEFAULT_BUCKET = "kyc-documents";
let supabaseClient: SupabaseClient | null = null;
const bucketReady = new Map<string, Promise<void>>();

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

async function ensurePrivateBucket(client: SupabaseClient, bucket = getStorageConfig().bucket, allowedMimeTypes: string[] = [...ALLOWED_MIME_TYPES], fileSizeLimit = "5MB"): Promise<void> {
  if (!bucketReady.has(bucket)) {
    const ready = (async () => {
      const listed = await client.storage.listBuckets();
      if (listed.error) throw listed.error;
      const existingBucket = listed.data.find(item => item.name === bucket);
      if (existingBucket?.public) throw new Error(`PRIVATE_BUCKET_REQUIRED:${bucket}`);
      if (!existingBucket) {
        const created = await client.storage.createBucket(bucket, {
          public: false,
          fileSizeLimit,
          allowedMimeTypes,
        });
        if (created.error) throw created.error;
      }
    })().catch(error => {
      bucketReady.delete(bucket);
      throw error;
    });
    bucketReady.set(bucket, ready);
  }
  await bucketReady.get(bucket);
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


const REPORT_BUCKET = String(process.env.SUPABASE_REPORTS_BUCKET || "admin-reports").trim();

export async function storePrivateReport(reportId: string, buffer: Buffer): Promise<string> {
  if (!/^[-a-zA-Z0-9_]{8,80}$/.test(reportId) || !buffer.subarray(0, 5).toString("ascii").startsWith("%PDF-")) {
    throw new Error("INVALID_REPORT_FILE");
  }
  if (REPORT_BUCKET === getStorageConfig().bucket) throw new Error("REPORT_BUCKET_MUST_BE_SEPARATE_FROM_KYC_BUCKET");
  const client = getSupabase();
  const objectPath = `reports/${reportId}.pdf`;
  if (client) {
    await ensurePrivateBucket(client, REPORT_BUCKET, ["application/pdf"], "50MB");
    const { error } = await client.storage.from(REPORT_BUCKET).upload(objectPath, buffer, {
      contentType: "application/pdf", cacheControl: "0", upsert: false,
    });
    if (error) throw error;
    return `supabase-report://${REPORT_BUCKET}/${objectPath}`;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("PRIVATE_REPORT_STORAGE_NOT_CONFIGURED: configure Supabase private storage before generating archived reports.");
  }
  const directory = path.resolve(process.env.REPORT_UPLOAD_DIR || path.join(process.cwd(), "uploads", "reports"));
  await mkdir(directory, { recursive: true });
  const destination = path.resolve(directory, `${reportId}.pdf`);
  await writeFile(destination, buffer, { flag: "wx", mode: 0o600 });
  return `local-report://${destination}`;
}

export async function readPrivateReport(reference: string): Promise<Buffer> {
  if (reference.startsWith("supabase-report://")) {
    const client = getSupabase();
    if (!client) throw new Error("PRIVATE_REPORT_STORAGE_NOT_CONFIGURED");
    const remainder = reference.slice("supabase-report://".length);
    const separator = remainder.indexOf("/");
    if (separator < 1 || remainder.slice(0, separator) !== REPORT_BUCKET) throw new Error("INVALID_PRIVATE_REPORT_REFERENCE");
    const objectPath = remainder.slice(separator + 1);
    if (!objectPath.startsWith("reports/") || objectPath.includes("..")) throw new Error("INVALID_PRIVATE_REPORT_REFERENCE");
    const { data, error } = await client.storage.from(REPORT_BUCKET).download(objectPath);
    if (error || !data) throw error || new Error("REPORT_NOT_FOUND");
    const buffer = Buffer.from(await data.arrayBuffer());
    if (!buffer.subarray(0, 5).toString("ascii").startsWith("%PDF-")) throw new Error("INVALID_REPORT_FILE");
    return buffer;
  }
  if (!reference.startsWith("local-report://")) throw new Error("INVALID_PRIVATE_REPORT_REFERENCE");
  const directory = path.resolve(process.env.REPORT_UPLOAD_DIR || path.join(process.cwd(), "uploads", "reports"));
  const resolved = path.resolve(reference.slice("local-report://".length));
  const relative = path.relative(directory, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("REPORT_PATH_OUTSIDE_PRIVATE_DIRECTORY");
  const buffer = await readFile(resolved);
  if (!buffer.subarray(0, 5).toString("ascii").startsWith("%PDF-")) throw new Error("INVALID_REPORT_FILE");
  return buffer;
}


export async function deletePrivateReport(reference: string): Promise<void> {
  if (reference.startsWith("supabase-report://")) {
    const client = getSupabase();
    if (!client) throw new Error("PRIVATE_REPORT_STORAGE_NOT_CONFIGURED");
    const remainder = reference.slice("supabase-report://".length);
    const separator = remainder.indexOf("/");
    if (separator < 1 || remainder.slice(0, separator) !== REPORT_BUCKET) throw new Error("INVALID_PRIVATE_REPORT_REFERENCE");
    const objectPath = remainder.slice(separator + 1);
    if (!objectPath.startsWith("reports/") || objectPath.includes("..")) throw new Error("INVALID_PRIVATE_REPORT_REFERENCE");
    const { error } = await client.storage.from(REPORT_BUCKET).remove([objectPath]);
    if (error) throw error;
    return;
  }
  if (reference.startsWith("local-report://")) {
    const directory = path.resolve(process.env.REPORT_UPLOAD_DIR || path.join(process.cwd(), "uploads", "reports"));
    const resolved = path.resolve(reference.slice("local-report://".length));
    const relative = path.relative(directory, resolved);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) await unlink(resolved).catch(() => {});
  }
}
