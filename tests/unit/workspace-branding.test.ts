// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Workspace Branding & Co-Branding Invariants", () => {
  it("enforces brand_config and logo_url in Workspace prisma schema", () => {
    const schemaPath = path.resolve(__dirname, "../../backend/prisma/schema.prisma");
    const schema = fs.readFileSync(schemaPath, "utf-8");

    expect(schema).toMatch(/model Workspace\s*\{[\s\S]*brandConfig\s+Json\?[\s\S]*logoUrl\s+String\?/);
  });

  it("enforces workspace branding routes with admin/owner permission check in backend", () => {
    const wsRouterPath = path.resolve(__dirname, "../../backend/src/routes/workspaces.ts");
    const content = fs.readFileSync(wsRouterPath, "utf-8");

    expect(content).toContain('workspaceRouter.get("/:workspaceId/branding"');
    expect(content).toContain('workspaceRouter.patch("/:workspaceId/branding"');
    expect(content).toContain("canManageBranding");
    expect(content).toContain("access.isWorkspaceOwner || access.membershipRole === \"admin\"");
  });

  it("projects brandConfig and logoUrl in account/workspaces endpoint", () => {
    const accountRouterPath = path.resolve(__dirname, "../../backend/src/routes/account.ts");
    const content = fs.readFileSync(accountRouterPath, "utf-8");

    expect(content).toContain("brandConfig: membership.workspace.brandConfig");
    expect(content).toContain("logoUrl: membership.workspace.logoUrl");
  });

  it("guarantees 'Powered by Operix' co-branding badge in sidebar and editor", () => {
    const sidebarPath = path.resolve(__dirname, "../../src/components/layout/AppSidebar.tsx");
    const sidebar = fs.readFileSync(sidebarPath, "utf-8");
    expect(sidebar).toContain("Powered by Operix");

    const editorPath = path.resolve(__dirname, "../../src/components/layout/BrandNameEditor.tsx");
    const editor = fs.readFileSync(editorPath, "utf-8");
    expect(editor).toContain("Powered by Operix");
    expect(editor).toContain("uploadFile");
  });
});
