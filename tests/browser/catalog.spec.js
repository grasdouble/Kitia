"use strict";

const { test: base, expect } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSiteServer } = require("../../scripts/serve-site.js");

const test = base.extend({
  catalogServer: [async ({}, use) => {
    const sourceDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-browser-test-"));
    fs.writeFileSync(path.join(sourceDataDirectory, "catalogSources.json"),
      JSON.stringify({ catalog_version: 1, sources: [] }));
    const server = createSiteServer({ sourceDataDirectory });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      await use(`http://127.0.0.1:${server.address().port}`);
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()));
      fs.rmSync(sourceDataDirectory, { recursive: true, force: true });
    }
  }, { scope: "worker" }],
  baseURL: async ({ catalogServer }, use) => { await use(catalogServer); },
});

test("empty first-party catalog explains the absence of resources", async ({ page }) => {
  await page.goto("/catalog.html");
  await expect(page.locator("#resource-count")).toContainText("0");
  await expect(page.locator(".resource-card")).toHaveCount(0);
  await expect(page.getByText("No resources match these filters.", { exact: false })).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: "Markdown catalog" })).toBeVisible();
});

test("installation options respect unsupported assistants and instruction and bundle scopes", async ({ page }) => {
  const resources = [
    { id: "single-client", kind: "skill", compatibility: { copilot: { status: "unsupported" }, claude: { status: "compatible" } } },
    { id: "project-rules", kind: "instruction", apply_to: ["**/*.js"] },
    { id: "project-bundle", kind: "bundle", resources: [{ catalog: "internal", kind: "instruction", id: "project-rules" }] },
    { id: "cli-server", kind: "mcp", mcp_config: { mcpServers: { example: { command: "example" } } } },
    { id: "unavailable", kind: "skill", compatibility: { copilot: { status: "unsupported" }, claude: { status: "unsupported" } } },
  ].map((resource) => ({ group: "general", description: "Synthetic test resource", ...resource }));
  await page.route("**/data/catalog.json", (route) => route.fulfill({ json: { resources } }));
  await page.goto("/catalog.html");
  const single = page.locator("#resource-internal-skill-single-client");
  await expect(single.locator(".quick-install-target")).toHaveText("Claude · This project");
  await single.locator(".quick-install-options").click();
  await expect(single.getByRole("radio", { name: "Both", exact: true })).toHaveCount(0);
  await expect(single.getByRole("radio", { name: "Copilot", exact: true })).toHaveCount(0);
  for (const [kind, id] of [["instruction", "project-rules"], ["bundle", "project-bundle"]]) {
    const card = page.locator(`#resource-internal-${kind}-${id}`);
    await card.locator(".quick-install-options").click();
    await expect(card.getByRole("radio", { name: "All projects", exact: true })).toHaveCount(0);
  }
  const mcp = page.locator("#resource-internal-mcp-cli-server");
  await mcp.locator(".quick-install-options").click();
  await expect(mcp.getByRole("radio", { name: "Copilot CLI", exact: true })).toBeVisible();
  await expect(mcp.getByRole("radio", { name: "Claude Code CLI", exact: true })).toBeVisible();
  await expect(page.locator("#resource-internal-skill-unavailable .quick-install-actions")).toBeHidden();
});

test("quick installation keeps configured source catalogs in the command", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
  await page.route("**/data/source-catalogs/catalogSources.json", (route) => route.fulfill({
    json: { catalog_version: 1, sources: [{ name: "community", repository: "https://github.com/example/community" }] },
  }));
  await page.route("**/data/source-catalogs/community.json", (route) => route.fulfill({
    json: {
      catalog_name: "community",
      source_repository: "example/community",
      source_ref: "a".repeat(40),
      resources: [{ id: "shared-skill", kind: "skill", description: "Synthetic source skill" }],
    },
  }));
  await page.goto("/catalog.html?q=shared-skill");
  const card = page.locator("#resource-community-skill-shared-skill");
  await card.locator(".quick-install-options").click();
  await card.getByRole("radio", { name: "All projects", exact: true }).check();
  await card.getByRole("button", { name: "Apply options", exact: true }).click();
  await card.getByRole("button", { name: "Copy install command", exact: true }).click();
  await expect(card.getByRole("status")).toHaveText("Installation command copied to clipboard.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "npx --yes github:grasdouble/Kitia install skill shared-skill --catalog community --tool both --scope user",
  );
  await expect(card.locator(".resource-details")).not.toHaveAttribute("open", "");
});

for (const width of [1024, 1440]) {
  test(`distribution packets travel smoothly within repository rows at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    const frames = await page.locator(".resource-packet").evaluateAll((packets) => packets.map((packet) => {
      const animation = packet.getAnimations()[0];
      animation.pause();
      const timing = animation.effect.getTiming();
      const rect = (element) => {
        const { left, right, top, width, height } = element.getBoundingClientRect();
        return { left, right, top, width, height };
      };
      const at = (progress) => {
        animation.currentTime = Number(timing.delay) + Number(timing.duration) * progress;
        const style = getComputedStyle(packet);
        return { ...rect(packet), opacity: Number(style.opacity), layoutLeft: style.left };
      };
      const repository = packet.closest(".repository-card");
      return {
        timing: timing.easing,
        properties: [...new Set(animation.effect.getKeyframes().flatMap((frame) =>
          Object.keys(frame).filter((key) => !["offset", "computedOffset", "easing", "composite"].includes(key))))].sort(),
        repository: rect(repository),
        hub: rect(document.querySelector(".catalog-hub")),
        connector: parseFloat(getComputedStyle(repository, "::before").width),
        hidden: packet.getAttribute("aria-hidden"),
        start: at(0.1), early: at(0.3), middle: at(0.4), late: at(0.68), fade: at(0.73), end: at(0.78),
      };
    }));
    expect(frames).toHaveLength(3);
    for (const frame of frames) {
      expect(frame.timing).toBe("linear");
      expect(frame.properties).toEqual(["opacity", "transform"]);
      expect(frame.hidden).toBe("true");
      expect(frame.start.height).toBeGreaterThanOrEqual(16);
      expect(frame.start.height).toBeLessThanOrEqual(24);
      expect(frame.start.width).toBeLessThan(frame.connector);
      expect(frame.start.left).toBeGreaterThan(frame.hub.left);
      expect(frame.end.left).toBeGreaterThan(frame.repository.left + frame.repository.width * 0.4);
      expect(frame.end.right).toBeLessThan(frame.repository.right);
      expect(frame.end.left - frame.start.left).toBeGreaterThan(frame.connector);
      expect(frame.fade.left).toBeGreaterThan(frame.late.left);
      expect(frame.fade.opacity).toBeCloseTo(0.5, 2);
      expect(frame.end.opacity).toBeCloseTo(0, 5);
      expect(frame.end.layoutLeft).toBe(frame.start.layoutLeft);
      expect(frame.middle.left - frame.early.left).toBeCloseTo((frame.fade.left - frame.late.left) * 2, 1);
      expect(frame.start.top + frame.start.height / 2).toBeCloseTo(frame.repository.top + frame.repository.height / 2, 0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("distribution remains readable with reduced motion and stacked layouts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  for (const packet of await page.locator(".resource-packet").all()) await expect(packet).toBeHidden();
  for (const card of await page.locator(".repository-card").all()) await expect(card).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const width of [390, 760]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const packet of await page.locator(".resource-packet").all()) await expect(packet).toBeHidden();
    await expect(page.getByText("Product repository", { exact: true })).toBeVisible();
    await expect(page.getByText("Platform repository", { exact: true })).toBeVisible();
    await expect(page.getByText("Service repository", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
