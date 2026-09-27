import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import pkg from "./package.json";

// The version shown in the footer. Scheme: 0.<PR>.<patch> - the minor number
// is the pull request that shipped it, so any screen can be traced back to
// its PR (see CHANGELOG.md). The commit pins the exact build.
function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unbekannt";
  }
}

const nextConfig: NextConfig = {
  // Firebase Hosting serves `frontend/out` (see firebase.json). Without this the
  // directory is never produced and a deploy ships nothing.
  output: "export",
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_GIT_SHA: gitSha(),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
