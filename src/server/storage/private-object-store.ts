import "server-only";

export type CreatePrivateUploadInput = {
  objectKey: string;
  contentType: string;
  contentLength: number;
  intentId: string;
  expiresInSeconds: number;
};

export type PrivateUploadTarget = {
  url: string;
  method: "PUT";
  requiredHeaders: Record<string, string>;
  expiresAt: Date;
};

export type PrivateObjectMetadata = {
  contentLength: number;
  contentType?: string;
  etag?: string;
  intentId?: string;
};

export type PutPrivateObjectInput = {
  objectKey: string;
  bytes: Uint8Array;
  contentType: string;
  metadata?: Record<string, string>;
};

export interface PrivateObjectStore {
  createUploadTarget(input: CreatePrivateUploadInput): Promise<PrivateUploadTarget>;
  headObject(objectKey: string): Promise<PrivateObjectMetadata | null>;
  getObjectBytes(objectKey: string, maximumBytes: number): Promise<Uint8Array>;
  putObjectBytes(input: PutPrivateObjectInput): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
}
