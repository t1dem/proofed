export const env = (name: string, fallback?: string) => {
  const value = process.env[name]?.trim() || fallback;
  if (value === undefined) throw new Error(`Missing ${name}`);
  return value;
};
