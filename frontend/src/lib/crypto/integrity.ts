export async function computeHash(
  file: File | Blob,
  onProgress?: (progress: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/hash.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (event: MessageEvent) => {
      const { type, hash, progress, error } = event.data;

      if (type === 'progress') {
        onProgress?.(progress);
      } else if (type === 'success') {
        resolve(hash);
        worker.terminate();
      } else if (type === 'error') {
        reject(new Error(error));
        worker.terminate();
      }
    };

    worker.onerror = (err) => {
      reject(err);
      worker.terminate();
    };

    worker.postMessage({ type: 'hash-file', file });
  });
}

export { computeHash as calculateFileHash };