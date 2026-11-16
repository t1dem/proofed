const checkNode = (version = process.versions.node) => {
  if (Number(version.split(".")[0]) >= 24) return;
  console.error(`proofed: Node 24 or newer is required (found ${version}). Install Node 24+ from https://nodejs.org/ and run this command again.`);
  process.exit(3);
};

module.exports = checkNode;
