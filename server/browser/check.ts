import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import type { Router } from "express";
import express from "express";

// Reachability check for the real retailer site before building the computer-use loop.
// Launches a real browser (installed Google Chrome if present, else Playwright's Chromium),
// opens one search page, and reports what came back. No sign-in, no checkout.

const require = createRequire(import.meta.url);

export const START_URLS: Record<string, string> = {
  sephora: "https://www.sephora.com/search?keyword=foundation",
  ulta: "https://www.ulta.com/shop/search?query=foundation",
  oliveyoung: "https://www.oliveyoung.com/",
};

export async function launchBrowser(headless: boolean) {
  const { chromium } = await import("playwright");
  const errors: string[] = [];
  for (const channel of ["chrome", undefined] as const) {
    try {
      const browser = await chromium.launch({ headless, ...(channel ? { channel } : {}) });
      return { browser, engine: channel ?? "chromium" };
    } catch (e: any) {
      errors.push(`${channel ?? "chromium"}: ${String(e.message).split("\n")[0]}`);
    }
  }
  throw new Error(`Could not start a browser. ${errors.join(" | ")}`);
}

const BLOCK_SIGNS = /access denied|captcha|are you a human|verify you are|request unsuccessful|pardon our interruption|blocked/i;

export function browserRouter(): Router {
  const r = express.Router();

  r.post("/check", async (req, res) => {
    const retailer = (req.body?.retailer as string) ?? "sephora";
    const headless = req.body?.headless !== false;
    const url = START_URLS[retailer];
    if (!url) return res.status(400).json({ error: `Unknown retailer ${retailer}` });
    let browser: any;
    try {
      const l = await launchBrowser(headless);
      browser = l.browser;
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "en-US" });
      const page = await ctx.newPage();
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(4000);
      const title = await page.title();
      const text = (await page.evaluate(() => document.body?.innerText ?? "")).slice(0, 3000);
      // Site patterns: where links go, and what a search through the site's own box produces.
      const links: string[] = await page.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href))).slice(0, 80)).catch(() => []);
      const dialogs: string[] = await page
        .evaluate(() => Array.from(document.querySelectorAll("[role=dialog], [aria-modal=true]")).map((d) => ((d as HTMLElement).innerText || "").replace(/\s+/g, " ").slice(0, 160)))
        .catch(() => []);
      let searchUrl: string | null = null;
      let searchTitle: string | null = null;
      let productLinks: string[] = [];
      if (req.body?.probeSearch) {
        const box = page.locator("input[type=search], input[name*=search i], input[placeholder*=search i], input[aria-label*=search i]").first();
        if (await box.count().catch(() => 0)) {
          await box.click({ timeout: 5000 }).catch(() => {});
          await box.fill("foundation").catch(() => {});
          await box.press("Enter").catch(() => {});
          await page.waitForTimeout(5000);
          searchUrl = page.url();
          searchTitle = await page.title().catch(() => null);
          productLinks = await page.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href))).filter((h) => /prod|goods|item|\/p\//i.test(h)).slice(0, 15)).catch(() => []);
        }
      }
      const shot = await page.screenshot({ type: "jpeg", quality: 60 });
      res.json({
        engine: l.engine,
        headless,
        status: resp?.status() ?? null,
        finalUrl: page.url(),
        title,
        looksBlocked: BLOCK_SIGNS.test(title + " " + text.slice(0, 800)),
        textSample: text.slice(0, 1200),
        links,
        dialogs,
        searchUrl,
        searchTitle,
        productLinks,
        screenshot: `data:image/jpeg;base64,${shot.toString("base64")}`,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    } finally {
      await browser?.close().catch(() => {});
    }
  });

  // Downloads Playwright's Chromium on this machine (used only if Google Chrome is not installed).
  r.post("/install", (_req, res) => {
    const cli = path.join(path.dirname(require.resolve("playwright-core/package.json")), "cli.js");
    const child = spawn(process.execPath, [cli, "install", "chromium"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => res.json({ code, output: out.slice(-2000) }));
  });

  return r;
}
