import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const specs = JSON.parse(
  await fs.readFile(path.join(root, "visual", "scenes.json"), "utf8"),
);
const baseUrl = process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:4173/gh-contrib-archive";
const outputDir = path.resolve(process.env.VISUAL_OUT ?? "visual-report/render");
await fs.mkdir(outputDir, { recursive: true });

const failures = [];

for (const spec of specs) {
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--disable-dev-shm-usage",
      "--ignore-gpu-blocklist",
      "--enable-webgl",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: spec.width, height: spec.height },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();

    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    const url = new URL(spec.route.replace(/^\//, ""), baseUrl.replace(/\/$/, "") + "/");
    await page.goto(url.toString(), {
      waitUntil: "networkidle",
      timeout: 45_000,
    });

    const canvas = page.locator("canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(spec.settleMs);

    const info = await canvas.evaluate((element) => {
      const canvas = /** @type {HTMLCanvasElement} */ (element);
      const rect = canvas.getBoundingClientRect();
      const webgl =
        canvas.getContext("webgl2") ||
        canvas.getContext("webgl") ||
        canvas.getContext("experimental-webgl");
      return {
        cssWidth: Math.round(rect.width),
        cssHeight: Math.round(rect.height),
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        webgl: Boolean(webgl),
      };
    });

    if (!info.webgl) {
      failures.push(`${spec.id}: canvas exists but WebGL context is unavailable`);
    }
    if (Math.abs(info.cssWidth - spec.width) > 1 || Math.abs(info.cssHeight - spec.height) > 1) {
      failures.push(
        `${spec.id}: canvas CSS size ${info.cssWidth}x${info.cssHeight} != target viewport ${spec.width}x${spec.height}`,
      );
    }
    if (pageErrors.length) {
      failures.push(`${spec.id}: page errors: ${pageErrors.join(" | ")}`);
    }

    const screenshotPath = path.join(outputDir, `${spec.id}.png`);
    await canvas.screenshot({
      path: screenshotPath,
      type: "png",
      animations: "disabled",
    });

    const metadata = {
      id: spec.id,
      url: url.toString(),
      target: spec.target,
      targetWidth: spec.width,
      targetHeight: spec.height,
      settleMs: spec.settleMs,
      canvas: info,
      consoleErrors,
      pageErrors,
    };
    await fs.writeFile(
      path.join(outputDir, `${spec.id}.json`),
      JSON.stringify(metadata, null, 2) + "\n",
    );

    console.log(
      `${spec.id}: captured ${info.cssWidth}x${info.cssHeight}, backing ${info.backingWidth}x${info.backingHeight}, webgl=${info.webgl}`,
    );

    await context.close();
  } finally {
    await browser.close();
  }
}

if (failures.length) {
  console.error("visual capture failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
