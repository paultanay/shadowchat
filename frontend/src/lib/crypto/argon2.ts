/**
 * Argon2id password key derivation coordinator using background Web Workers.
 */

export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    // Spawns the worker using standard Next.js import.meta.url pattern
    const worker = new Worker(
      new URL('../../workers/crypto.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.addEventListener('message', (event: MessageEvent) => {
      const { type, hash, error } = event.data;

      if (type === 'success') {
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

    // Send the hashing job parameters to the worker
    worker.postMessage({
      type: 'argon2id',
      password,
      salt,
      parallelism: 1,
      iterations: 2,
      memorySize: 19456, // 19 MiB
      hashLength: 32,
    });
  });
}
