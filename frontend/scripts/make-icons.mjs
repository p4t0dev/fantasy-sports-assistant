// Renders the home-screen icons from src/app/icon.svg. Run it from frontend/
// after changing the SVG; the PNGs are committed, the build does not need this.
import sharp from "sharp";

const SOURCE = "src/app/icon.svg";
const TARGETS = [
  ["src/app/apple-icon.png", 180],
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
];

for (const [path, size] of TARGETS) {
  await sharp(SOURCE, { density: 300 }).resize(size, size).flatten().png().toFile(path);
}
