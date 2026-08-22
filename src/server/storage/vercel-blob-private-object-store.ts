import "server-only";

import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";

import type { PrivateObjectStore } from "./private-object-store";

export function createVercelBlobPrivateObjectStore(): PrivateObjectStore {
  return {
    async headObject(objectKey) {
      try {
        const blob = await head(objectKey);
        return {
          contentLength: blob.size,
          contentType: blob.contentType,
          etag: blob.etag,
        };
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
    },

    async getObjectBytes(objectKey, maximumBytes) {
      const result = await get(objectKey, { access: "private", useCache: false });
      if (!result || result.statusCode !== 200) throw new Error("OBJECT_NOT_FOUND");
      if (result.blob.size > maximumBytes) throw new Error("OBJECT_TOO_LARGE");

      const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
      if (bytes.byteLength > maximumBytes) throw new Error("OBJECT_TOO_LARGE");
      return bytes;
    },

    async putObjectBytes(input) {
      await put(input.objectKey, Buffer.from(input.bytes), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: input.contentType,
        cacheControlMaxAge: 60,
      });
    },

    async deleteObject(objectKey) {
      await del(objectKey);
    },
  };
}
