// Refuses installs from anything other than pnpm.
//
// All Node package managers populate `npm_config_user_agent` with their own
// identifier when they invoke lifecycle scripts (e.g. "pnpm/9.12.3 npm/?
// node/v22.x linux x64"). We check the prefix; npm and yarn are rejected
// with a clear message.
//
// This project deliberately avoids npm (CLI and lifecycle invocation) for
// supply-chain reasons. See README "Package manager policy" for the why.

const ua = process.env.npm_config_user_agent ?? "";
const tool = ua.split("/")[0] || "(unknown)";

if (!ua.startsWith("pnpm/")) {
  console.error("");
  console.error("  ✗ This project uses pnpm exclusively.");
  console.error(`    Detected package manager: ${tool}`);
  console.error("");
  console.error("    Install pnpm:");
  console.error("      corepack enable && corepack prepare pnpm@latest --activate");
  console.error("    Or follow: https://pnpm.io/installation");
  console.error("");
  console.error("    Then run: pnpm install");
  console.error("");
  process.exit(1);
}
