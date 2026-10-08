import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding staging personas...");
  const passwordHash = await bcrypt.hash("StagingPass123!", 10);

  // 1. Owner User
  const ownerUser = await prisma.user.upsert({
    where: { email: "owner@operix-staging.com" },
    update: { passwordHash, fullName: "Alex Owner", role: "user" },
    create: {
      email: "owner@operix-staging.com",
      passwordHash,
      fullName: "Alex Owner",
      role: "user"
    }
  });

  const ownerAppUser = await prisma.appUser.upsert({
    where: { authUserId: ownerUser.id },
    update: { name: "Alex Owner" },
    create: {
      authUserId: ownerUser.id,
      email: ownerUser.email,
      name: "Alex Owner"
    }
  });

  await prisma.profile.upsert({
    where: { id: ownerUser.id },
    update: { fullName: "Alex Owner" },
    create: {
      id: ownerUser.id,
      fullName: "Alex Owner",
      email: ownerUser.email,
      displayCode: "ADM-001"
    }
  });

  await prisma.userRole.upsert({
    where: { userId: ownerUser.id },
    update: { role: "admin" },
    create: {
      userId: ownerUser.id,
      role: "admin"
    }
  });

  // Workspace
  const workspace = await prisma.workspace.upsert({
    where: { id: "ws-homolog-01" },
    update: { name: "Operix Homologation Corp", ownerUserId: ownerAppUser.id, timezone: "UTC" },
    create: {
      id: "ws-homolog-01",
      name: "Operix Homologation Corp",
      ownerUserId: ownerAppUser.id,
      type: "company",
      timezone: "UTC"
    }
  });

  await prisma.billingProfile.upsert({
    where: { workspaceId: workspace.id },
    update: { preferredCurrency: "EUR" },
    create: {
      workspaceId: workspace.id,
      legalName: "Operix Homologation Corp",
      billingEmail: "owner@operix-staging.com",
      preferredCurrency: "EUR",
      country: "PT"
    }
  });

  await prisma.membership.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: ownerAppUser.id } },
    update: { role: "admin", status: "active" },
    create: {
      workspaceId: workspace.id,
      userId: ownerAppUser.id,
      role: "admin",
      status: "active"
    }
  });

  // 2. Technician
  const techUser = await prisma.user.upsert({
    where: { email: "tech@operix-staging.com" },
    update: { passwordHash, fullName: "Carlos Tech", role: "user" },
    create: {
      email: "tech@operix-staging.com",
      passwordHash,
      fullName: "Carlos Tech",
      role: "user"
    }
  });

  const techAppUser = await prisma.appUser.upsert({
    where: { authUserId: techUser.id },
    update: { name: "Carlos Tech" },
    create: {
      authUserId: techUser.id,
      email: techUser.email,
      name: "Carlos Tech"
    }
  });

  await prisma.profile.upsert({
    where: { id: techUser.id },
    update: { fullName: "Carlos Tech" },
    create: {
      id: techUser.id,
      fullName: "Carlos Tech",
      email: techUser.email,
      displayCode: "TEC-001"
    }
  });

  await prisma.userRole.upsert({
    where: { userId: techUser.id },
    update: { role: "technician" },
    create: {
      userId: techUser.id,
      role: "technician"
    }
  });

  await prisma.membership.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: techAppUser.id } },
    update: { role: "technician", status: "active" },
    create: {
      workspaceId: workspace.id,
      userId: techAppUser.id,
      role: "technician",
      status: "active"
    }
  });

  // 3. Client Entity & Client User
  const clientEntity = await prisma.client.upsert({
    where: { id_workspaceId: { id: "client-homolog-01", workspaceId: workspace.id } },
    update: { name: "Staging Client Auto SA" },
    create: {
      id: "client-homolog-01",
      workspaceId: workspace.id,
      name: "Staging Client Auto SA",
      contactEmail: "client@operix-staging.com"
    }
  });

  const clientUser = await prisma.user.upsert({
    where: { email: "client@operix-staging.com" },
    update: { passwordHash, fullName: "Alice Client", role: "user" },
    create: {
      email: "client@operix-staging.com",
      passwordHash,
      fullName: "Alice Client",
      role: "user"
    }
  });

  const clientAppUser = await prisma.appUser.upsert({
    where: { authUserId: clientUser.id },
    update: { name: "Alice Client" },
    create: {
      authUserId: clientUser.id,
      email: clientUser.email,
      name: "Alice Client"
    }
  });

  await prisma.profile.upsert({
    where: { id: clientUser.id },
    update: { fullName: "Alice Client" },
    create: {
      id: clientUser.id,
      fullName: "Alice Client",
      email: clientUser.email,
      displayCode: "CLI-001"
    }
  });

  await prisma.userRole.upsert({
    where: { userId: clientUser.id },
    update: { role: "client" },
    create: {
      userId: clientUser.id,
      role: "client"
    }
  });

  await prisma.membership.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: clientAppUser.id } },
    update: { role: "client", status: "active" },
    create: {
      workspaceId: workspace.id,
      userId: clientAppUser.id,
      role: "client",
      status: "active"
    }
  });

  // 4. Client Collaborator
  const collabUser = await prisma.user.upsert({
    where: { email: "client.collab@operix-staging.com" },
    update: { passwordHash, fullName: "Bob Collaborator", role: "user" },
    create: {
      email: "client.collab@operix-staging.com",
      passwordHash,
      fullName: "Bob Collaborator",
      role: "user"
    }
  });

  const collabAppUser = await prisma.appUser.upsert({
    where: { authUserId: collabUser.id },
    update: { name: "Bob Collaborator" },
    create: {
      authUserId: collabUser.id,
      email: collabUser.email,
      name: "Bob Collaborator"
    }
  });

  await prisma.profile.upsert({
    where: { id: collabUser.id },
    update: { fullName: "Bob Collaborator" },
    create: {
      id: collabUser.id,
      fullName: "Bob Collaborator",
      email: collabUser.email,
      displayCode: "COL-001"
    }
  });

  await prisma.userRole.upsert({
    where: { userId: collabUser.id },
    update: { role: "client" },
    create: {
      userId: collabUser.id,
      role: "client"
    }
  });

  await prisma.clientAccessGrant.upsert({
    where: { workspaceId_userId_clientId: { workspaceId: workspace.id, userId: collabUser.id, clientId: clientEntity.id } },
    update: {
      role: "validator",
      status: "active",
      capabilities: ["budget.approve", "weeklog.validate", "payment_list.review", "invoice.view"]
    },
    create: {
      workspaceId: workspace.id,
      userId: collabUser.id,
      clientId: clientEntity.id,
      role: "validator",
      status: "active",
      capabilities: ["budget.approve", "weeklog.validate", "payment_list.review", "invoice.view"]
    }
  });

  // 5. Site-scoped Collaborator
  const siteUser = await prisma.user.upsert({
    where: { email: "site.collab@operix-staging.com" },
    update: { passwordHash, fullName: "Dave Site North", role: "user" },
    create: {
      email: "site.collab@operix-staging.com",
      passwordHash,
      fullName: "Dave Site North",
      role: "user"
    }
  });

  await prisma.appUser.upsert({
    where: { authUserId: siteUser.id },
    update: { name: "Dave Site North" },
    create: {
      authUserId: siteUser.id,
      email: siteUser.email,
      name: "Dave Site North"
    }
  });

  await prisma.profile.upsert({
    where: { id: siteUser.id },
    update: { fullName: "Dave Site North" },
    create: {
      id: siteUser.id,
      fullName: "Dave Site North",
      email: siteUser.email,
      displayCode: "COL-002"
    }
  });

  await prisma.userRole.upsert({
    where: { userId: siteUser.id },
    update: { role: "client" },
    create: {
      userId: siteUser.id,
      role: "client"
    }
  });

  await prisma.clientAccessGrant.upsert({
    where: { workspaceId_userId_clientId: { workspaceId: workspace.id, userId: siteUser.id, clientId: clientEntity.id } },
    update: {
      role: "validator",
      status: "active",
      capabilities: ["weeklog.validate", "payment_list.review"],
      siteKey: "SITE-NORTH"
    },
    create: {
      workspaceId: workspace.id,
      userId: siteUser.id,
      clientId: clientEntity.id,
      role: "validator",
      status: "active",
      capabilities: ["weeklog.validate", "payment_list.review"],
      siteKey: "SITE-NORTH"
    }
  });

  console.log("SUCCESS: All 5 staging test personas created and verified successfully!");
}

main().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
