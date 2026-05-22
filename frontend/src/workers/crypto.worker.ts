import { argon2id } from 'hash-wasm';

// Handle messages from the main thread
self.addEventListener('message', async (event: MessageEvent) => {
  const { type, password, salt, parallelism, iterations, memorySize, hashLength } = event.data;

  if (type === 'argon2id') {
    try {
      const hash = await argon2id({
        password,
        salt,
        parallelism: parallelism || 1,
        iterations: iterations || 2,
        memorySize: memorySize || 19456, // 19 MiB (19456 KB)
        hashLength: hashLength || 32,
        outputType: 'binary',
      });

      self.postMessage({ type: 'success', hash });
    } catch (error: any) {
      self.postMessage({ type: 'error', error: error.message || 'Argon2id hashing failed' });
    }
  }
});
