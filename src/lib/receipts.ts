import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { uuid } from "./uuid";

// Receipt images live in a dedicated Supabase project (storage only). Everything else is in Firebase.
let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env["VITE_RECEIPTS_SUPABASE_URL"];
  const key = import.meta.env["VITE_RECEIPTS_SUPABASE_ANON_KEY"];
  if (!url || !key) throw new Error("Receipt storage isn't configured (VITE_RECEIPTS_SUPABASE_URL / _ANON_KEY).");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** Shrink phone-camera photos before upload (max 1600px, JPEG ≈ 0.8). Falls back to the original file. */
async function compress(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export async function uploadReceipt(file: File, month: string): Promise<string> {
  const sb = getClient();
  const body = await compress(file);
  const ext = body.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() ?? "jpg").toLowerCase();
  const path = `${month}/${uuid()}.${ext}`; // unguessable path
  const { error } = await sb.storage.from("receipts").upload(path, body, { contentType: body.type || "image/jpeg", upsert: false });
  if (error) throw new Error(`Receipt upload failed: ${error.message}`);
  return sb.storage.from("receipts").getPublicUrl(path).data.publicUrl;
}
