// Regenerate the native tray bitmap from its editable vector source.
// Tauri requires RGBA; rasterization happens here, never at app startup.
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
const source = new URL("../desktop/icons/tray.svg", import.meta.url);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const svg = await readFile(source, "utf8");
  const result = await page.evaluate(async (svg) => {
    const image = new Image();
    image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 36;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, 36, 36);
    return {
      rgba: Array.from(ctx.getImageData(0, 0, 36, 36).data),
      png: canvas.toDataURL("image/png").split(",")[1],
    };
  }, svg);
  await writeFile(
    new URL("../desktop/icons/tray.rgba", import.meta.url),
    Buffer.from(result.rgba),
  );
  await writeFile(
    new URL("../desktop/icons/tray.png", import.meta.url),
    Buffer.from(result.png, "base64"),
  );
} finally {
  await browser.close();
}
