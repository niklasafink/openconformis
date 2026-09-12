import "server-only";

import type { PrivateObjectStore } from "./private-object-store";
import { createS3PrivateObjectStore } from "./s3-private-object-store";
import { createVercelBlobPrivateObjectStore } from "./vercel-blob-private-object-store";

/**
 * Der gehostete Betrieb lädt über Vercel Blob hoch; ohne gesetzten Treiber ist
 * das auch der gelesene Speicher. Beides muss dieselbe Voreinstellung haben —
 * stünde hier S3, würde jede hochgeladene Datei in einen Speicher geschrieben
 * und aus einem anderen gelesen, und die Aufbereitung schlüge stumm fehl.
 */
export function resolveStorageDriver(configuredDriver = process.env.STORAGE_DRIVER) {
  return configuredDriver?.trim() || "vercel-blob";
}

/**
 * Jede Policy-Fassung merkt sich ihren Treiber. Ein späterer Wechsel von
 * `STORAGE_DRIVER` darf ältere Originale nicht unlesbar machen, deshalb
 * entscheidet für vorhandene Objekte die Spalte und nicht die Umgebung.
 */
export function createPrivateObjectStore(
  storageDriver = resolveStorageDriver(),
): PrivateObjectStore {
  if (storageDriver === "vercel-blob") return createVercelBlobPrivateObjectStore();
  return createS3PrivateObjectStore();
}
