import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "public/manifest.webmanifest"), "utf8")
);

describe("PWA manifest", () => {
  it("has an installable, root-scoped application identity", () => {
    expect(manifest.name).toBe("MyHomeBro");
    expect(manifest.start_url).toMatch(/^\/app\//);
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
  });

  it("provides any-purpose and maskable icons", () => {
    expect(manifest.icons.some((icon) => icon.sizes === "192x192")).toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === "512x512")).toBe(true);
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) {
      expect(icon.src).toMatch(/^\/(?:favicon|pwa-maskable)/);
      expect(icon.src).not.toMatch(/^\/static\//);
    }
  });

  it("limits shortcuts to non-destructive destinations", () => {
    expect(manifest.shortcuts).toHaveLength(2);
    for (const shortcut of manifest.shortcuts) {
      expect(shortcut.url).toMatch(/^\/app\/capture/);
    }
  });
});
