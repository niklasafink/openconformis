import "server-only";

import type { PrivateObjectStore } from "./private-object-store";
import { createS3PrivateObjectStore } from "./s3-private-object-store";
import { createVercelBlobPrivateObjectStore } from "./vercel-blob-private-object-store";

export function createPrivateObjectStore(): PrivateObjectStore {
  if (process.env.STORAGE_DRIVER === "vercel-blob") {
    return createVercelBlobPrivateObjectStore();
  }
  return createS3PrivateObjectStore();
}
