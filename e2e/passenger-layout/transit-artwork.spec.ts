import { expect, test } from "@playwright/test";

test("the persistent artwork loads a sharp candidate and fills the viewport", async ({ page }) => {
  await page.goto("/");
  const image = page.locator(".transit-artwork img");
  await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const painting = await image.evaluate(element => {
    const img = element as HTMLImageElement;
    const frame = img.getBoundingClientRect();
    const portrait = matchMedia("(orientation: portrait)").matches;
    const width = portrait ? 841 : 1672;
    const height = portrait ? 1870 : 941;
    const fit = Math.max(frame.width / width, frame.height / height);
    return {
      src: img.currentSrc,
      fit: getComputedStyle(img).objectFit,
      orientation: portrait ? "portrait" : "landscape",
      requiredWidth: Math.min(width, width * fit * devicePixelRatio),
      frame: { width: frame.width, height: frame.height },
    };
  });
  expect(painting.fit).toBe("cover");
  expect(painting.src).toContain(`bus-background-${painting.orientation}-trees-`);
  const candidate = Number(/trees-(\d+)\.webp/.exec(painting.src)?.[1]);
  expect(candidate).toBeGreaterThanOrEqual(Math.floor(painting.requiredWidth));
  expect(painting.frame.width).toBe(page.viewportSize()!.width);
  expect(painting.frame.height).toBe(page.viewportSize()!.height);
  expect((await page.request.get(painting.src)).status()).toBe(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);

  // The shell retains the very same painting after the interactive panel mounts.
  await page.locator("[data-passenger-workspace] nav").getByRole("button", { name: "Profile", exact: true }).click();
  await page.locator("[data-passenger-workspace] nav").getByRole("button", { name: "Map", exact: true }).click();
  expect(await image.evaluate(img => (img as HTMLImageElement).currentSrc)).toBe(painting.src);
});

test("a high density phone switches between the approved compositions on rotation", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  try {
    const page = await context.newPage();
    await page.goto("/");
    const image = page.locator(".transit-artwork img");
    await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).currentSrc)).toContain("bus-background-portrait-trees-841.webp");
    await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).currentSrc)).toContain("bus-background-landscape-trees-1672.webp");
    await image.evaluate(img => (img as HTMLImageElement).decode());
    await expect(image).toHaveCSS("object-fit", "cover");
    await expect(page.locator(".transit-artwork")).toHaveCSS("height", "390px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(844);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).currentSrc)).toContain("bus-background-portrait-trees-841.webp");
  } finally {
    await context.close();
  }
});

test("the initial load fetches only one WebP composition and no large PNG source", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => {
    if (request.url().includes("/images/bus-background-")) requests.push(request.url());
  });
  await page.goto("/");
  const image = page.locator(".transit-artwork img");
  const portrait = page.viewportSize()!.width <= page.viewportSize()!.height;
  await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).currentSrc)).toContain(`bus-background-${portrait ? "portrait" : "landscape"}-trees-`);
  await image.evaluate(img => (img as HTMLImageElement).decode());
  expect(new Set(requests).size).toBe(1);
  expect(requests.every(url => url.endsWith(".webp"))).toBe(true);
  expect(requests.every(url => url.includes(`bus-background-${portrait ? "portrait" : "landscape"}-trees-`))).toBe(true);
  for (const file of ["portrait-trees-841", "landscape-trees-1672"]) {
    const response = await page.request.get(`/images/bus-background-${file}.webp`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/webp");
  }
});
