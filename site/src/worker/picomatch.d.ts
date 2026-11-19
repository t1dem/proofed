declare module "picomatch/posix.js" {
  const picomatch: {
    isMatch(path: string, pattern: string, options?: { nonegate?: boolean }): boolean;
  };
  export default picomatch;
}
