import "server-only";

export type PrivateObjectMetadata = {
  contentLength: number;
  contentType?: string;
  etag?: string;
  intentId?: string;
};

/**
 * Geschrieben wird ausschließlich vom Browser gegen Vercel Blob; der Server
 * liest, prüft und löscht nur. Deshalb hat dieser Vertrag bewusst keine
 * Schreiboperation.
 */
export interface PrivateObjectStore {
  headObject(objectKey: string): Promise<PrivateObjectMetadata | null>;
  getObjectBytes(objectKey: string, maximumBytes: number): Promise<Uint8Array>;
  deleteObject(objectKey: string): Promise<void>;
}
