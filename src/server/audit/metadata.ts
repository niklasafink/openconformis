const forbiddenMetadataKey =
  /(api.?key|credential|document|evidence|ip.?address|policy|prompt|quote|raw|secret|text|token)/i;

export type AuditMetadataValue = string | number | boolean | null;
export type AuditMetadata = Record<string, AuditMetadataValue>;

export function createAuditMetadata(values: AuditMetadata = {}): AuditMetadata {
  for (const [key, value] of Object.entries(values)) {
    if (forbiddenMetadataKey.test(key)) {
      throw new Error(`Audit metadata key is forbidden: ${key}`);
    }

    if (typeof value === "string" && value.length > 256) {
      throw new Error(`Audit metadata value is too long: ${key}`);
    }
  }

  return values;
}
