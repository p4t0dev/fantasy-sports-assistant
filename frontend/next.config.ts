import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Firebase Hosting serves `frontend/out` (see firebase.json). Without this the
  // directory is never produced and a deploy ships nothing.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
