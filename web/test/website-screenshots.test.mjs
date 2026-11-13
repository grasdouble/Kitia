import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import sharp from "sharp";

for (const [filename, originalSize] of [
  ["catalog-browser-termless.webp", 96_673],
  ["workspace-inventory-termless.webp", 100_978],
]) {
  test(`${filename} is a valid optimized website screenshot`, async () => {
    const path = fileURLToPath(new URL(`../assets/${filename}`, import.meta.url));
    const [buffer, metadata, file] = await Promise.all([
      sharp(path).toBuffer(),
      sharp(path).metadata(),
      stat(path),
    ]);

    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 1036);
    assert.equal(metadata.height, 788);
    assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
    assert.equal(buffer.toString("ascii", 8, 12), "WEBP");
    assert.ok(file.size < originalSize, "WebP should be smaller than the original PNG capture");
  });
}
