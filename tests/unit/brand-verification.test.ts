// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Brand Verification & Health Service Endpoint", () => {
  it("enforces canonical Operix branding on /api/health and forbids legacy qw-nexus branding", () => {
    const indexPath = path.resolve(__dirname, "../../backend/src/index.ts");
    const content = fs.readFileSync(indexPath, "utf-8");

    // Must not contain legacy qw-nexus-api
    expect(content).not.toContain('"qw-nexus-api"');
    expect(content).not.toContain("'qw-nexus-api'");

    // Must declare canonical operix-api in /api/health
    expect(content).toContain('service: "operix-api"');
  });
});
