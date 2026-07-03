import { Storage } from "@google-cloud/storage";

const storage = new Storage();

/**
 * Short-lived V4 signed read URL so AssemblyAI can fetch the recording
 * without the bucket ever being public. 2 hours covers transcription-queue
 * worst cases at provider side.
 */
export async function signedReadUrl(bucket: string, objectName: string): Promise<string> {
  const [url] = await storage
    .bucket(bucket)
    .file(objectName)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 2 * 60 * 60 * 1000,
    });
  return url;
}
