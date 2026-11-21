// A path segment as text, or undefined when its percent-encoding is broken (decodeURIComponent throws on "%E0").
export function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

// A request another site made the browser send: Sec-Fetch-Site says so when the browser sends it, Origin
// otherwise. Requests with neither (curl, scripts) carry no browser's cookies by accident, so they pass.
export function fromOtherSite(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = request.headers.get("origin");
  return origin !== null && origin !== new URL(request.url).origin;
}

// Who a visitor is, for the per-visitor limit: an IPv4 address, or an IPv6 address's /64, since one
// connection hands out a whole /64 and changing the last half of the address costs nothing.
export function visitorAddress(ip: string | null) {
  if (!ip) return "unknown";
  if (!ip.includes(":") || ip.includes(".")) return ip; // IPv4, or IPv4 written as IPv6 (::ffff:1.2.3.4)
  const [head = "", tail] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
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
