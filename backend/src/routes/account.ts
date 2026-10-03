import { Router, type NextFunction, type Response } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { buildPermissionsForRole, normalizePermissionRole, type PermissionRole } from "../lib/permissionPolicy.js";
import { isEmailConfigured, sendEmail } from "../lib/email/resend.js";
import { operationalNotificationEmail } from "../lib/email/templates.js";

const updateProfileSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  phone: z.string().max(50).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  avatar_url: z.string().max(500).nullable().optional(),
});

const notificationEmailSchema = z.object({
  title: z.string().min(2).max(200),
  body: z.string().max(5000).optional().nullable(),
  source: z.string().min(1).max(80),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
});

export const accountRouter = Router();

accountRouter.use(requireAuth);

type EffectiveAccessContext = {
  user: {
    id: string;
    email: string;
    isActive: boolean;
    role: string;
    profile: { isSystemOwner: boolean } | null;
    appUser: {
      id: string;
      workspaceId: string | null;
      memberships: Array<{
        workspaceId: string;
        role: string;
        workspace: { ownerUserId: string; name: string };
      }>;
    } | null;
  };
  currentWorkspaceId: string | null;
  membershipRole: PermissionRole | null;
  effectiveDbRole: PermissionRole | null;
  isWorkspaceOwner: boolean;
};

function toDisplayRole(role: string | null) {
  switch (normalizePermissionRole(role)) {
    case "owner":
      return "owner";
    case "admin":
      return "admin";
    case "partner":
      return "associe";
    case "technician":
      return "technicien";
    case "client":
      return "client";
    default:
      return null;
  }
}

function toLegacyDisplayRole(role: PermissionRole | null) {
  switch (role) {
    case "owner":
    case "admin":
      return "admin";
    case "partner":
      return "socio";
    case "technician":
      return "tecnico";
    case "client":
      return "cliente";
    default:
      return null;
  }
}

async function resolveEffectiveAccessContext(
  targetUserId: string,
  requestedWorkspaceId?: string | null,
): Promise<EffectiveAccessContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      email: true,
      isActive: true,
      role: true,
      appUser: {
        select: {
          id: true,
          workspaceId: true,
          memberships: {
            where: { status: "active" },
            select: {
              workspaceId: true,
              role: true,
              workspace: {
                select: {
                  ownerUserId: true,
                  name: true,
                },
              },
            },
          },
        },
      },
      profile: {
        select: {
          isSystemOwner: true,
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  const memberships: NonNullable<EffectiveAccessContext["user"]["appUser"]>["memberships"] =
    user.appUser?.memberships ?? [];
  const requestedMembership = requestedWorkspaceId
    ? memberships.find((membership) => membership.workspaceId === requestedWorkspaceId) ?? null
    : null;
  const currentMembership =
    requestedMembership ??
    memberships.find((membership) => membership.workspaceId === user.appUser?.workspaceId) ??
    memberships[0] ??
    null;
  const currentWorkspaceId = currentMembership?.workspaceId ?? requestedWorkspaceId ?? user.appUser?.workspaceId ?? null;
  const membershipRole = normalizePermissionRole(currentMembership?.role);
  const isWorkspaceOwner = !!user.appUser?.id && !!currentMembership?.workspace.ownerUserId && currentMembership.workspace.ownerUserId === user.appUser.id;
  const effectiveDbRole = isWorkspaceOwner ? "owner" : membershipRole ?? normalizePermissionRole(user.role);

  return {
    user,
    currentWorkspaceId,
    membershipRole,
    effectiveDbRole,
    isWorkspaceOwner,
  };
}

accountRouter.get("/profile", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const profile = await prisma.profile.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        address: true,
        avatarUrl: true,
        displayCode: true,
      },
    });

    if (!profile) {
      return res.status(404).json({ message: "Profile not found." });
    }

    return res.json({
      profile: {
        id: profile.id,
        full_name: profile.fullName,
        email: profile.email,
        phone: profile.phone,
        address: profile.address,
        avatar_url: profile.avatarUrl,
        display_code: profile.displayCode,
      },
    });
  } catch (error) {
    return next(error);
  }
});

accountRouter.post("/notifications/email", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const input = notificationEmailSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true, email: true, fullName: true, appUser: { select: { workspaceId: true } } },
    });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    if (!isEmailConfigured()) {
      return res.status(503).json({ message: "Email provider not configured." });
    }
    const tpl = operationalNotificationEmail({
      title: input.title,
      body: input.body ?? null,
      source: input.source,
      priority: input.priority,
    });
    const sendResult = await sendEmail({
      to: user.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
    if (!sendResult.ok) {
      return res.status(502).json({ message: sendResult.error });
    }

    await prisma.backendEventLog.create({
      data: {
        tableName: "notifications",
        rowId: null,
        action: "notification.email.sent",
        actorUserId: user.id,
        workspaceId: user.appUser?.workspaceId ?? null,
        payload: {
          provider: sendResult.provider,
          email_id: sendResult.id,
          source: input.source,
          priority: input.priority,
          title: input.title,
        } as Prisma.InputJsonValue,
      },
    });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

accountRouter.patch("/profile", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const input = updateProfileSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);

    const profile = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updatedProfile = await tx.profile.update({
        where: { id: req.auth!.userId },
        data: {
          fullName: input.full_name,
          phone: input.phone,
          address: input.address,
          avatarUrl: input.avatar_url,
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          address: true,
          avatarUrl: true,
          displayCode: true,
        },
      });

      await tx.appUser.update({
        where: { authUserId: req.auth!.userId },
        data: {
          name: input.full_name,
          phone: input.phone,
        },
      });

      await tx.user.update({
        where: { id: req.auth!.userId },
        data: {
          fullName: input.full_name,
        },
      });

      return updatedProfile;
    });

    return res.json({
      profile: {
        id: profile.id,
        full_name: profile.fullName,
        email: profile.email,
        phone: profile.phone,
        address: profile.address,
        avatar_url: profile.avatarUrl,
        display_code: profile.displayCode,
      },
    });
  } catch (error) {
    return next(error);
  }
});

accountRouter.get("/role", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const querySchema = z.object({
      userId: z.string().min(1).optional(),
      workspaceId: z.string().min(1).optional(),
    });
    const { userId, workspaceId } = querySchema.parse((req as AuthenticatedRequest & { query: unknown }).query);
    const targetUserId = userId ?? req.auth!.userId;

    if (targetUserId !== req.auth!.userId && req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const access = await resolveEffectiveAccessContext(targetUserId, workspaceId ?? null);
    if (!access) {
      return res.status(404).json({ message: "User not found." });
    }

    return res.json({
      role: access.effectiveDbRole,
      membership_role: access.membershipRole,
      is_workspace_owner: access.isWorkspaceOwner,
      workspace_id: access.currentWorkspaceId,
    });
  } catch (error) {
    return next(error);
  }
});

accountRouter.get("/workspaces", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const appUser = await prisma.appUser.findUnique({
      where: { authUserId: req.auth!.userId },
      select: {
        id: true,
        memberships: {
          where: { status: "active" },
          select: {
            workspaceId: true,
            role: true,
            status: true,
            workspace: {
              select: {
                id: true,
                name: true,
                ownerUserId: true,
              },
            },
          },
        },
      },
    });

    return res.json({
      appUserId: appUser?.id ?? null,
      workspaces:
        appUser?.memberships.map((membership: {
          workspaceId: string;
          role: string;
          status: string;
          workspace: { name: string; ownerUserId: string };
        }) => ({
          workspaceId: membership.workspaceId,
          workspaceName: membership.workspace.name,
          ownerAppUserId: membership.workspace.ownerUserId,
          membershipRole: membership.role,
          membershipStatus: membership.status,
        })) ?? [],
    });
  } catch (error) {
    return next(error);
  }
});

accountRouter.get("/context", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const querySchema = z.object({
      userId: z.string().min(1).optional(),
      workspaceId: z.string().min(1).optional(),
    });
    const { userId, workspaceId } = querySchema.parse((req as AuthenticatedRequest & { query: unknown }).query);
    const targetUserId = userId ?? req.auth!.userId;

    if (targetUserId !== req.auth!.userId && req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const access = await resolveEffectiveAccessContext(targetUserId, workspaceId ?? null);
    if (!access) {
      return res.status(404).json({ message: "User not found." });
    }

    const { user } = access;
    const workspaceIds =
      user.appUser?.memberships.map((membership: { workspaceId: string; role: string; workspace: { ownerUserId: string; name: string } }) => membership.workspaceId) ??
      [];
    const primaryRole = toDisplayRole(access.effectiveDbRole);
    const effectiveLegacyRole = toLegacyDisplayRole(access.effectiveDbRole);

    return res.json({
      context: {
        auth_user_id: user.id,
        app_user_id: user.appUser?.id ?? null,
        email: user.email,
        is_active: user.isActive,
        is_system_owner: user.profile?.isSystemOwner ?? false,
        primary_role: primaryRole,
        primary_db_role: access.effectiveDbRole,
        global_db_role: user.role,
        secondary_roles: [],
        current_workspace_id: access.currentWorkspaceId,
        workspace_ids: workspaceIds,
        membership_role: access.membershipRole,
        effective_role: primaryRole,
        effective_legacy_role: effectiveLegacyRole,
        effective_db_role: access.effectiveDbRole,
        is_workspace_owner: access.isWorkspaceOwner,
        can_manage_all: access.effectiveDbRole === "owner" || access.effectiveDbRole === "admin",
        can_view_all_workspace: access.effectiveDbRole === "owner" || access.effectiveDbRole === "admin",
        ownership: {
          technician_id: access.effectiveDbRole === "technician" ? user.appUser?.id ?? null : null,
          owns_filter_uids: user.id ? [user.id] : [],
        },
        flags: {
          is_admin: access.effectiveDbRole === "owner" || access.effectiveDbRole === "admin",
          is_owner: access.effectiveDbRole === "owner",
          is_partner: access.effectiveDbRole === "partner",
          is_technician: access.effectiveDbRole === "technician",
          is_client: access.effectiveDbRole === "client",
          is_impersonating: false,
        },
        computed_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    return next(error);
  }
});

accountRouter.get("/permissions", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const querySchema = z.object({
      userId: z.string().min(1).optional(),
      workspaceId: z.string().min(1).optional(),
    });
    const { userId, workspaceId } = querySchema.parse((req as AuthenticatedRequest & { query: unknown }).query);
    const targetUserId = userId ?? req.auth!.userId;

    if (targetUserId !== req.auth!.userId && req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const access = await resolveEffectiveAccessContext(targetUserId, workspaceId ?? null);
    if (!access) {
      return res.status(404).json({ message: "User not found." });
    }

    const permissions = buildPermissionsForRole(access.effectiveDbRole);
    return res.json({
      role: access.effectiveDbRole,
      membership_role: access.membershipRole,
      is_workspace_owner: access.isWorkspaceOwner,
      workspace_id: access.currentWorkspaceId,
      ...permissions,
    });
  } catch (error) {
    return next(error);
  }
});
