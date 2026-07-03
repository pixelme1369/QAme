import { Storage } from "@google-cloud/storage";

const storage = new Storage();

/**
 * Short-lived signed URL for dashboard playback. The bucket stays private;
 * the browser gets 15 minutes of read access to exactly one object, minted
 * only after RBAC has passed.
 */
export async function playbackUrl(bucket: string, objectName: string): Promise<string> {
  const [url] = await storage
    .bucket(bucket)
    .file(objectName)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 15 * 60 * 1000,
    });
  return url;
}
