// Best-effort scrubbing of key material from memory. This is defense-in-depth,
// NOT a guarantee: V8 may have copied a Buffer's contents (GC compaction, a
// base64 conversion, etc.) and we cannot reach those copies. It is still worth
// doing — it shrinks the window a plaintext key lingers in a longer-lived buffer
// (e.g. the per-request key cache) after we are done with it.

export function zeroize(...buffers: Array<Buffer | null | undefined>): void {
  for (const buf of buffers) {
    if (buf && Buffer.isBuffer(buf) && buf.length > 0) {
      buf.fill(0);
    }
  }
}
