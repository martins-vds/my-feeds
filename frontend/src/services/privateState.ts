let version = 0;
let validation: { version: number; done: Promise<void>; resolve: () => void } | null = null;

export function getPrivateStateVersion(): number {
  return version;
}

export function beginPrivateStateValidation(): number {
  invalidatePrivateState();
  let resolve!: () => void;
  const done = new Promise<void>((complete) => {
    resolve = complete;
  });
  validation = { version, done, resolve };
  return version;
}

export function finishPrivateStateValidation(validationVersion: number): void {
  if (validation?.version !== validationVersion) return;
  const current = validation;
  validation = null;
  current.resolve();
}

export async function waitForPrivateStateValidation(): Promise<void> {
  while (validation) await validation.done;
}

export async function purgePrivateCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  const names = await caches.keys();
  await Promise.all(
    names
      .filter(
        (name) =>
          name.startsWith("api-cache-") ||
          name.startsWith("audio-cache-") ||
          name === "images-cache-v1"
      )
      .map((name) => caches.delete(name))
  );
}

export function invalidatePrivateState(): void {
  version += 1;
  const current = validation;
  validation = null;
  current?.resolve();
  void purgePrivateCaches().catch(() => {
    // Some private-browsing modes disable CacheStorage. Private requests still
    // fail closed via the version boundary and never use an offline fallback.
  });
  if (typeof navigator !== "undefined") {
    navigator.serviceWorker?.controller?.postMessage({ type: "PURGE_PRIVATE_CACHES" });
  }
}
