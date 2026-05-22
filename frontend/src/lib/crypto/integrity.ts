/**
 * Incremental file hash coordinator using background Web Workers.
 */

export async function calculateFileHash(
  file: File | Blob,
  onProgress?: (progress: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/hash.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.addEventListener('message', (event: MessageEvent) => {
      const { type, hash, progress, error } = event.data;

      if (type === 'progress') {
        if (onProgress) {
          onProgress(progress);
        }
      } else if (type === 'success') {
        resolve(hash);
        worker.terminate();
      } else if (type === 'error') {
        reject(new Error(error));
        worker.terminate();
      }
    });

    worker.addEventListener('error', (err) => {
      reject(err);
      worker.terminate();
    });

    worker.postMessage({
      type: 'hash-file',
      file,
    });
  });
}
