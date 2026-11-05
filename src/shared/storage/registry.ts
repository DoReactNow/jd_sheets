// The only file that imports a storage driver (architecture rule 8). STORAGE_DRIVER chooses it.
// The s3 driver is planned (Decision 19) and added when production needs it.
import { getEnv, type Env } from "@/shared/config/env";
import { createLocalStorage } from "./drivers/local";
import type { FileStorage } from "./fileStorage";

export type StorageConfig = Pick<Env, "STORAGE_DRIVER"> & Partial<Pick<Env, "STORAGE_LOCAL_DIR">>;

export function createFileStorage(config: StorageConfig): FileStorage {
  const driver: string = config.STORAGE_DRIVER;
  switch (driver) {
    case "local":
      if (!config.STORAGE_LOCAL_DIR) throw new Error("STORAGE_DRIVER=local needs STORAGE_LOCAL_DIR");
      return createLocalStorage({ root: config.STORAGE_LOCAL_DIR });
    case "s3":
      throw new Error("STORAGE_DRIVER=s3 is not available yet; use local (Decision 19)");
    default:
      throw new Error(`Unknown STORAGE_DRIVER "${driver}"`);
  }
}

let cached: FileStorage | undefined;

/** The configured storage. Called at app and worker start, so a wrong driver fails immediately. */
export function getFileStorage(): FileStorage {
  cached ??= createFileStorage(getEnv());
  return cached;
}
