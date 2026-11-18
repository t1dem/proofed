export function phase(label: string) {
  if (process.env.GITHUB_ACTIONS !== "true") return () => {};
  const start = performance.now();
  return () => console.log(`Proofed timing ${label}: ${((performance.now() - start) / 1000).toFixed(2)}s`);
}

export function timed<T>(label: string, run: () => T): T {
  const end = phase(label);
  try { return run(); }
  finally { end(); }
}

export async function timedAsync<T>(label: string, run: () => Promise<T>): Promise<T> {
  const end = phase(label);
  try { return await run(); }
  finally { end(); }
}
