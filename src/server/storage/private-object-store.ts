import "server-only";

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
  headObject(objectKey: string): Promise<PrivateObjectMetadata | null>;
  getObjectBytes(objectKey: string, maximumBytes: number): Promise<Uint8Array>;
  putObjectBytes(input: PutPrivateObjectInput): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
}
