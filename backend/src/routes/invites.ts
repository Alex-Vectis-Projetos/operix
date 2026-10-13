import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { notifyWorkspaceInvite, notifyInviteAccepted } from "../services/notificationService.js";

export const invitesRouter = Router();
invitesRouter.use(requireAuth);

const normalizeRole = (role: string): string => {
  switch ((role ?? "").trim().toLowerCase()) {
    case "admin": return "admin";
    case "partner": case "associe": case "associé": case "socio": return "partner";
    case "technician": case "technicien": case "tecnico": return "technician";
    case "client": case "cliente": return "client";
    default: return role;
  }
};

// POST /workspaces/:workspaceId/invites
invitesRouter.post("/workspaces/:workspaceId/invites", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.params);
    const { display_code, role } = z.object({
      display_code: z.string().min(1),
      role: z.string().min(1),
    }).parse(req.body);

    const appUser = await prisma.appUser.findUnique({
      where: { authUserId: req.auth!.userId },
      select: { id: true },
    });
    if (!appUser) return res.status(404).json({ message: "App user not found." });

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, ownerUserId: true },
    });
    if (!workspace) return res.status(404).json({ message: "Workspace not found." });

    const isOwner = workspace.ownerUserId === appUser.id;
    const membership = await prisma.membership.findFirst({
      where: { workspaceId, userId: appUser.id, status: "active" },
      select: { role: true },
    });
    const canManage = isOwner || normalizeRole(membership?.role ?? "") === "admin";
    if (!canManage) return res.status(403).json({ message: "Forbidden." });

    const targetProfile = await prisma.profile.findFirst({
      where: { displayCode: display_code.toUpperCase() },
      select: { id: true, fullName: true, email: true },
    });
    if (!targetProfile) return res.status(404).json({ message: "Utilizador não encontrado com esse código." });

    const existingMembership = await prisma.membership.findFirst({
      where: {
        workspaceId,
        user: { user: { profile: { id: targetProfile.id } } },
        status: "active",
      },
    });
    if (existingMembership) return res.status(409).json({ message: "Este utilizador já é membro do workspace." });

    const existingPending = await prisma.workspaceInvite.findFirst({
      where: { workspaceId, targetProfileId: targetProfile.id, status: "pending" },
    });
    if (existingPending) return res.status(409).json({ message: "Já existe um convite pendente para este utilizador." });

    const invite = await prisma.workspaceInvite.create({
      data: {
        workspaceId,
        targetProfileId: targetProfile.id,
        role: normalizeRole(role),
        createdBy: appUser.id,
      },
    });

    await notifyWorkspaceInvite(targetProfile.id, workspace.name, role, invite.id);

    return res.status(201).json({ invite: { id: invite.id, status: invite.status } });
  } catch (error) {
    return next(error);
  }
});

// GET /workspaces/:workspaceId/invites
invitesRouter.get("/workspaces/:workspaceId/invites", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.params);

    const appUser = await prisma.appUser.findUnique({
      where: { authUserId: req.auth!.userId },
      select: { id: true },
    });
    if (!appUser) return res.status(404).json({ message: "App user not found." });

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerUserId: true },
    });
    if (!workspace) return res.status(404).json({ message: "Workspace not found." });

    const isOwner = workspace.ownerUserId === appUser.id;
    const membership = await prisma.membership.findFirst({
      where: { workspaceId, userId: appUser.id, status: "active" },
    });
    if (!isOwner && !membership) return res.status(403).json({ message: "Forbidden." });

    const invites = await prisma.workspaceInvite.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    });

    const profileIds = [...new Set(invites.map((i) => i.targetProfileId))];
    const profiles = profileIds.length > 0
      ? await prisma.profile.findMany({
          where: { id: { in: profileIds } },
          select: { id: true, fullName: true, email: true, displayCode: true },
        })
      : [];
    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    return res.json({
      invites: invites.map((inv) => {
        const prof = profileMap.get(inv.targetProfileId);
        return {
          id: inv.id,
          workspace_id: inv.workspaceId,
          target_profile_id: inv.targetProfileId,
          target_full_name: prof?.fullName ?? null,
          target_email: prof?.email ?? null,
          target_display_code: prof?.displayCode ?? null,
          role: inv.role,
          status: inv.status,
          created_by: inv.createdBy,
          created_at: inv.createdAt.toISOString(),
          responded_at: inv.respondedAt?.toISOString() ?? null,
        };
      }),
    });
  } catch (error) {
    return next(error);
  }
});

// GET /invites/incoming
invitesRouter.get("/invites/incoming", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const profile = await prisma.profile.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true },
    });
    if (!profile) return res.json({ invites: [] });

    const invites = await prisma.workspaceInvite.findMany({
      where: { targetProfileId: profile.id, status: "pending" },
      orderBy: { createdAt: "desc" },
    });

    const workspaceIds = [...new Set(invites.map((i) => i.workspaceId))];
    const workspaces = workspaceIds.length > 0
      ? await prisma.workspace.findMany({
          where: { id: { in: workspaceIds } },
          select: { id: true, name: true },
        })
      : [];
    const wsMap = new Map(workspaces.map((w) => [w.id, w.name]));

    return res.json({
      invites: invites.map((inv) => ({
        id: inv.id,
        workspace_id: inv.workspaceId,
        workspace_name: wsMap.get(inv.workspaceId) ?? null,
        target_profile_id: inv.targetProfileId,
        role: inv.role,
        status: inv.status,
        created_by: inv.createdBy,
        created_at: inv.createdAt.toISOString(),
        responded_at: inv.respondedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

// PATCH /invites/:inviteId/accept
invitesRouter.patch("/invites/:inviteId/accept", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteId } = z.object({ inviteId: z.string() }).parse(req.params);

    const profile = await prisma.profile.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true },
    });
    if (!profile) return res.status(404).json({ message: "Profile not found." });

    const invite = await prisma.workspaceInvite.findUnique({
      where: { id: inviteId },
      select: { id: true, workspaceId: true, targetProfileId: true, role: true, status: true, createdBy: true },
    });

    if (!invite || invite.targetProfileId !== profile.id) {
      return res.status(404).json({ message: "Convite não encontrado." });
    }
    if (invite.status !== "pending") {
      return res.status(409).json({ message: "Convite já foi respondido." });
    }

    const appUser = await prisma.appUser.findUnique({
      where: { authUserId: req.auth!.userId },
      select: { id: true, name: true },
    });
    if (!appUser) return res.status(404).json({ message: "App user not found." });

    await prisma.$transaction(async (tx) => {
      await tx.workspaceInvite.update({
        where: { id: invite.id },
        data: { status: "accepted", respondedAt: new Date() },
      });

      await tx.membership.upsert({
        where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: appUser.id } },
        update: { role: invite.role, status: "active" },
        create: {
          workspaceId: invite.workspaceId,
          userId: appUser.id,
          role: invite.role,
          status: "active",
          source: "invite_accepted",
        },
      });

      await tx.appUser.update({
        where: { id: appUser.id },
        data: { workspaceId: invite.workspaceId },
      });
    });

    // Notify the inviter in-app
    if (invite.createdBy) {
      const creatorAppUser = await prisma.appUser.findUnique({
        where: { id: invite.createdBy },
        select: { authUserId: true },
      });
      const ws = await prisma.workspace.findUnique({
        where: { id: invite.workspaceId },
        select: { name: true },
      });
      if (creatorAppUser?.authUserId) {
        await notifyInviteAccepted(creatorAppUser.authUserId, appUser.name || "Novo membro", ws?.name || "Workspace");
      }
    }

    return res.json({ message: "Convite aceito." });
  } catch (error) {
    return next(error);
  }
});

// PATCH /invites/:inviteId/reject
invitesRouter.patch("/invites/:inviteId/reject", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteId } = z.object({ inviteId: z.string() }).parse(req.params);

    const profile = await prisma.profile.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true },
    });
    if (!profile) return res.status(404).json({ message: "Profile not found." });

    const invite = await prisma.workspaceInvite.findUnique({
      where: { id: inviteId },
      select: { id: true, targetProfileId: true, status: true },
    });

    if (!invite || invite.targetProfileId !== profile.id) {
      return res.status(404).json({ message: "Convite não encontrado." });
    }
    if (invite.status !== "pending") {
      return res.status(409).json({ message: "Convite já foi respondido." });
    }

    await prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { status: "rejected", respondedAt: new Date() },
    });

    return res.json({ message: "Convite recusado." });
  } catch (error) {
    return next(error);
  }
});

// DELETE /invites/:inviteId — cancel (workspace admin/owner only)
invitesRouter.delete("/invites/:inviteId", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteId } = z.object({ inviteId: z.string() }).parse(req.params);

    const appUser = await prisma.appUser.findUnique({
      where: { authUserId: req.auth!.userId },
      select: { id: true },
    });
    if (!appUser) return res.status(404).json({ message: "App user not found." });

    const invite = await prisma.workspaceInvite.findUnique({
      where: { id: inviteId },
      select: { id: true, workspaceId: true, status: true },
    });
    if (!invite) return res.status(404).json({ message: "Convite não encontrado." });
    if (invite.status !== "pending") return res.status(409).json({ message: "Convite já foi respondido." });

    const workspace = await prisma.workspace.findUnique({
      where: { id: invite.workspaceId },
      select: { ownerUserId: true },
    });
    const isOwner = workspace?.ownerUserId === appUser.id;
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: invite.workspaceId, userId: appUser.id, status: "active" },
      select: { role: true },
    });
    const canManage = isOwner || normalizeRole(membership?.role ?? "") === "admin";
    if (!canManage) return res.status(403).json({ message: "Forbidden." });

    await prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { status: "cancelled" },
    });

    return res.json({ message: "Convite cancelado." });
  } catch (error) {
    return next(error);
  }
});
