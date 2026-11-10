import type { Pipe } from "../types";
export const PIPES_KEY = "tj-pipes-v1";
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function isPipe(value: unknown): value is Pipe {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    p.id.length > 0 &&
    typeof p.brand === "string" &&
    typeof p.model === "string" &&
    [
      "shape",
      "material",
      "filter",
      "status",
      "date",
      "notes",
      "createdAt",
      "updatedAt",
    ].every((k) => p[k] === undefined || typeof p[k] === "string") &&
    (p.price == null ||
      (typeof p.price === "number" && Number.isFinite(p.price))) &&
    (p.photo == null ||
      p.photo === "" ||
      (typeof p.photo === "string" &&
        /^data:image\/(png|jpeg|webp);base64,/.test(p.photo)))
  );
}
function validatePipes(value: unknown): Pipe[] {
  if (!Array.isArray(value) || value.length > 10000 || !value.every(isPipe))
    throw new Error("invalidData");
  if (new Set(value.map((p) => p.id)).size !== value.length)
    throw new Error("duplicateIds");
  return value;
}
// Keep the original schema and every unknown field; no write occurs during loading.
export function loadPipes(storage: StorageLike): {
  pipes: Pipe[];
  error: string | null;
} {
  try {
    const raw = storage.getItem(PIPES_KEY);
    return {
      pipes: raw === null ? [] : validatePipes(JSON.parse(raw)),
      error: null,
    };
  } catch {
    return { pipes: [], error: "storageRead" };
  }
}
export function savePipes(storage: StorageLike, pipes: Pipe[]): void {
  validatePipes(pipes);
  storage.setItem(PIPES_KEY, JSON.stringify(pipes));
}
export function createBackup(pipes: Pipe[]) {
  return JSON.stringify(
    {
      format: "tobacco-journal-pipes",
      version: 1,
      exportedAt: new Date().toISOString(),
      pipes,
    },
    null,
    2,
  );
}
export function parseBackup(raw: string): Pipe[] {
  const obj = JSON.parse(raw);
  if (!obj || obj.format !== "tobacco-journal-pipes" || obj.version !== 1)
    throw new Error("invalidBackup");
  return validatePipes(obj.pipes);
}
export function downloadJson(contents: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([contents], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
