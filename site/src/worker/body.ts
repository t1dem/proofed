// A path segment as text, or undefined when its percent-encoding is broken (decodeURIComponent throws on "%E0").
export function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

// The body is read up to the limit and no further, so a large upload never sits in memory whole.
export async function readUpTo(request: Request, max: number): Promise<Uint8Array | undefined> {
  if (Number(request.headers.get("content-length") ?? 0) > max) return undefined;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

// Small form bodies are objects. Reject malformed or oversized input before it reaches a handler.
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | undefined> {
  const bytes = await readUpTo(request, 16_384);
  if (!bytes) return undefined;
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
