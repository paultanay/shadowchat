import { createSHA256 } from 'hash-wasm';

const CHUNK_SIZE = 1024 * 1024; // 1 MB chunks for hashing

self.addEventListener('message', async (event: MessageEvent) => {
  const { type, file } = event.data;

  if (type === 'hash-file') {
    try {
      const hasher = await createSHA256();
      const size = file.size;
      let offset = 0;

      while (offset < size) {
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        
        // Read slice as ArrayBuffer
        const buffer = await slice.arrayBuffer();
        hasher.update(new Uint8Array(buffer));
        
        offset += CHUNK_SIZE;
        const progress = Math.min(100, (offset / size) * 100);
        
        self.postMessage({
          type: 'progress',
          progress,
        });
      }

      const hash = hasher.digest();
      self.postMessage({ type: 'success', hash });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'SHA-256 hashing failed';
      self.postMessage({ type: 'error', error: msg });
    }
  }
});
