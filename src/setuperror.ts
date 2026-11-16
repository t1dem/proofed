// Proofed could not run: a missing tool, an app that doesn't answer, a scenario that doesn't parse.
// `code` is stable, for scripts and agents; `fix` is the exact command or step that fixes it.
export class SetupError extends Error {
  code: string;
  fix: string;
  constructor(code: string, message: string, fix: string) {
    super(message);
    this.code = code;
    this.fix = fix;
  }
}
