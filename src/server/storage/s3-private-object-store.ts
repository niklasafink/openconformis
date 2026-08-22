import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { PrivateObjectStore, PrivateUploadTarget } from "./private-object-store";

type StorageConfig = {
  driver: "r2" | "minio" | "s3";
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function requireStorageValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Object storage is not configured: ${name} is missing.`);
  return value;
}

export function getStorageConfig(): StorageConfig {
  const driver = process.env.STORAGE_DRIVER;
  if (driver !== "r2" && driver !== "minio" && driver !== "s3") {
    throw new Error("STORAGE_DRIVER must be r2, minio, or s3.");
  }

  const endpoint = requireStorageValue("S3_ENDPOINT");
  if (process.env.NODE_ENV === "production" && !endpoint.startsWith("https://")) {
    throw new Error("Production object storage must use an HTTPS endpoint.");
  }

  return {
    driver,
    endpoint,
    bucket: requireStorageValue("S3_BUCKET"),
    region: process.env.S3_REGION?.trim() || "auto",
    accessKeyId: requireStorageValue("S3_ACCESS_KEY_ID"),
    secretAccessKey: requireStorageValue("S3_SECRET_ACCESS_KEY"),
  };
}

export function createS3PrivateObjectStore(config = getStorageConfig()): PrivateObjectStore {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.driver === "minio",
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    async createUploadTarget(input): Promise<PrivateUploadTarget> {
      const requiredHeaders = {
        "content-type": input.contentType,
        "x-amz-meta-upload-intent": input.intentId,
      };
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: input.objectKey,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
        Metadata: { "upload-intent": input.intentId },
      });

      return {
        url: await getSignedUrl(client, command, {
          expiresIn: input.expiresInSeconds,
          signableHeaders: new Set(["content-type"]),
          unhoistableHeaders: new Set(["x-amz-meta-upload-intent"]),
        }),
        method: "PUT",
        requiredHeaders,
        expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
      };
    },

    async headObject(objectKey) {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }),
        );

        return {
          contentLength: result.ContentLength ?? 0,
          contentType: result.ContentType,
          etag: result.ETag?.replaceAll('"', ""),
          intentId: result.Metadata?.["upload-intent"],
        };
      } catch (error) {
        if (error instanceof NotFound || (error as { name?: string }).name === "NotFound") {
          return null;
        }
        throw error;
      }
    },

    async getObjectBytes(objectKey, maximumBytes) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }),
      );

      if (!result.Body) throw new Error("OBJECT_BODY_MISSING");
      if ((result.ContentLength ?? 0) > maximumBytes) throw new Error("OBJECT_TOO_LARGE");

      const bytes = await result.Body.transformToByteArray();
      if (bytes.byteLength > maximumBytes) throw new Error("OBJECT_TOO_LARGE");
      return bytes;
    },

    async putObjectBytes(input) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: input.objectKey,
          Body: input.bytes,
          ContentLength: input.bytes.byteLength,
          ContentType: input.contentType,
          Metadata: input.metadata,
        }),
      );
    },

    async deleteObject(objectKey) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }));
    },
  };
}
