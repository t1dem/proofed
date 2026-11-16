// 22.18 is the first Node 22 that runs TypeScript without a flag (a checkout runs the source); the
// built package needs path.matchesGlob, from 22.5.
const MIN = [22, 18];
const NEED = `Node ${MIN.join(".")} or newer`;

const supported = (version) => {
  const [major, minor] = version.split(".").map(Number);
  return major > MIN[0] || (major === MIN[0] && minor >= MIN[1]);
};

const checkNode = (version = process.versions.node) => {
  if (process.versions.bun) {
    console.error(`proofed: ${NEED} is required. Install Node ${MIN[0]} or newer from https://nodejs.org/ and put node on PATH. Run proofed without --bun.`);
    process.exit(3);
  }
  if (supported(version)) return;
  console.error(`proofed: ${NEED} is required (found ${version}). Install Node ${MIN[0]} or newer from https://nodejs.org/ (any current LTS) and run this command again.`);
  process.exit(3);
};

module.exports = checkNode;
module.exports.supported = supported;
module.exports.NEED = NEED;
