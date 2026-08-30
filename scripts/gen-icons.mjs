#!/usr/bin/env node
/**
 * Generate PWA icons from src/assets/brand-mark.png into public/icons/.
 * Regenerate with: npm run icons
 */
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src", "assets", "brand-mark.png");
const outDir = join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

const BG = "#121a16"; // app background, used for maskable padding

async function main() {
  // Plain icons (transparent) at 192 / 512.
  for (const size of [192, 512]) {
    await sharp(src)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(join(outDir, `icon-${size}.png`));
  }
  // Maskable 512: mark centered on the brand background with safe padding.
  const inner = Math.round(512 * 0.72);
  const mark = await sharp(src).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: BG } })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toFile(join(outDir, `maskable-512.png`));
  // Apple touch icon (180, opaque bg for iOS).
  const appleInner = Math.round(180 * 0.78);
  const markA = await sharp(src).resize(appleInner, appleInner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp({ create: { width: 180, height: 180, channels: 4, background: BG } })
    .composite([{ input: markA, gravity: "centre" }])
    .png()
    .toFile(join(outDir, `apple-touch-icon.png`));
  console.log("✅ icons written to public/icons/");
}
main().catch((e) => { console.error(e); process.exit(1); });
