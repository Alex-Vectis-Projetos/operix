import { Router, type NextFunction, type Response } from "express";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { generateDisplayCode } from "../lib/displayCode.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { buildBillingContext } from "../lib/subscription.js";
import { updateMemberMembershipOnly } from "../lib/membershipService.js";

const createWorkspaceSchema = z.object({
  name: z.string().min(2).max(120),
  legalName: z.string().min(2).max(200),
  billingEmail: z.string().email(),
  vatNumber: z.string().max(50).optional().nullable(),
  country: z.string().min(2).max(2).default("PT"),
});

const workspaceMemberRoleSchema = z.enum([
  "admin",
  "partner",
  "technician",
  "client",
  "associe",
  "associé",
  "socio",
  "technicien",
  "tecnico",
  "cliente",
]);

const createWorkspaceMemberSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  fullName: z.string().min(2).max(200),
  role: workspaceMemberRoleSchema,
});

const updateWorkspaceMemberSchema = z.object({
  role: workspaceMemberRoleSchema.optional(),
  status: z.enum(["active", "inactive"]).optional(),
}).refine((value) => value.role !== undefined || value.status !== undefined, {
  message: "No changes requested.",
});

export const workspaceRouter = Router();

workspaceRouter.use(requireAuth);

type NormalizedWorkspaceRole = "admin" | "partner" | "technician" | "client";

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function normalizeWorkspaceRole(role: string | null | undefined): NormalizedWorkspaceRole | null {
  switch ((role ?? "").trim().toLowerCase()) {
    case "admin":
      return "admin";
    case "partner":
    case "associe":
    case "associé":
    case "socio":
      return "partner";
    case "technician":
    case "technicien":
    case "tecnico":
      return "technician";
    case "client":
    case "cliente":
      return "client";
    default:
      return null;
  }
}

function toWorkspaceRoleLabel(role: NormalizedWorkspaceRole | null, isWorkspaceOwner = false) {
  if (isWorkspaceOwner) {
    return "Owner";
  }
  switch (role) {
    case "admin":
      return "Admin";
    case "partner":
      return "Associe";
    case "technician":
      return "Technicien";
    case "client":
      return "Client";
    default:
      return "Membre";
  }
}

function buildTempPassword() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  const bytes = randomBytes(14);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

async function resolveWorkspaceAccess(authUserId: string, workspaceId: string) {
  const [appUser, workspace] = await Promise.all([
    prisma.appUser.findUnique({
      where: { authUserId },
      select: { id: true, workspaceId: true },
    }),
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, ownerUserId: true },
    }),
  ]);

  if (!appUser) {
    return { appUser: null, workspace, membershipRole: null, isWorkspaceOwner: false, canAccess: false, canManageMembers: false };
  }

  const membership = await prisma.membership.findFirst({
    where: {
      workspaceId,
      userId: appUser.id,
      status: "active",
    },
    select: { role: true },
  });

  const membershipRole = normalizeWorkspaceRole(membership?.role);
  const isWorkspaceOwner = !!workspace && workspace.ownerUserId === appUser.id;
  const canAccess = isWorkspaceOwner || !!membership;
  const canManageMembers = isWorkspaceOwner || membershipRole === "admin";

  return {
    appUser,
    workspace,
    membershipRole,
    isWorkspaceOwner,
    canAccess,
    canManageMembers,
  };
}

async function loadLastSeenByAuthUserIds(authUserIds: string[]) {
  if (authUserIds.length === 0) {
    return new Map<string, string>();
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ user_id: string; last_seen_at: Date | null }>>(Prisma.sql`
      SELECT user_id, MAX(last_seen_at) AS last_seen_at
      FROM public.user_devices
      WHERE user_id IN (${Prisma.join(authUserIds)})
      GROUP BY user_id
    `);

    return new Map(
      rows
        .filter((row: { user_id: string; last_seen_at: Date | null }) => !!row.last_seen_at)
        .map((row: { user_id: string; last_seen_at: Date | null }) => [row.user_id, row.last_seen_at!.toISOString()]),
    );
  } catch {
    return new Map<string, string>();
  }
}

workspaceRouter.post("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const input = createWorkspaceSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);

    const appUser = await prisma.appUser.findUnique({
      where: { authUserId: req.auth!.userId },
      select: { id: true, workspaceId: true },
    });

    if (!appUser) {
      return res.status(404).json({ message: "App user not found." });
    }

    const workspace = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const createdWorkspace = await tx.workspace.create({
        data: {
          name: input.name.trim(),
          ownerUserId: appUser.id,
        },
      });

      await tx.membership.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: createdWorkspace.id,
            userId: appUser.id,
          },
        },
        update: {
          role: "admin",
          status: "active",
          source: "onboarding",
        },
        create: {
          workspaceId: createdWorkspace.id,
          userId: appUser.id,
          role: "admin",
          status: "active",
          source: "onboarding",
        },
      });

      await tx.billingProfile.upsert({
        where: { workspaceId: createdWorkspace.id },
        update: {
          legalName: input.legalName.trim(),
          billingEmail: input.billingEmail.trim().toLowerCase(),
          vatNumber: input.vatNumber?.trim() || null,
          country: input.country.toUpperCase(),
          isBusiness: true,
          companyName: input.legalName.trim(),
        },
        create: {
          workspaceId: createdWorkspace.id,
          legalName: input.legalName.trim(),
          billingEmail: input.billingEmail.trim().toLowerCase(),
          vatNumber: input.vatNumber?.trim() || null,
          country: input.country.toUpperCase(),
          isBusiness: true,
          companyName: input.legalName.trim(),
        },
      });

      await tx.appUser.update({
        where: { id: appUser.id },
        data: { workspaceId: createdWorkspace.id },
      });

      await tx.workspaceSubscription.upsert({
        where: { workspaceId: createdWorkspace.id },
        update: {
          planCode: "starter",
          status: "trial",
          billingCycle: "monthly",
          trialStartedAt: new Date(),
          trialEndsAt: addDays(new Date(), 14),
        },
        create: {
          workspaceId: createdWorkspace.id,
          planCode: "starter",
          status: "trial",
          billingCycle: "monthly",
          trialStartedAt: new Date(),
          trialEndsAt: addDays(new Date(), 14),
        },
      });

      await tx.subscriptionEvent.create({
        data: {
          workspaceId: createdWorkspace.id,
          eventType: "trial_started",
          severity: "info",
          message: "Workspace criada com periodo experimental ativo.",
        },
      });

      return createdWorkspace;
    });

    return res.status(201).json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        owner_user_id: workspace.ownerUserId,
      },
    });
  } catch (error) {
    return next(error);
  }
});

workspaceRouter.get("/:workspaceId/billing-context", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const paramsSchema = z.object({
      workspaceId: z.string().uuid(),
    });
    const { workspaceId } = paramsSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);

    const appUser = await prisma.appUser.findUnique({
      where: { authUserId: req.auth!.userId },
      select: { id: true },
    });

    if (!appUser) {
      return res.status(404).json({ message: "App user not found." });
    }

    const access = await prisma.membership.findFirst({
      where: {
        workspaceId,
        userId: appUser.id,
        status: "active",
      },
      select: { id: true },
    });

    if (!access && req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        createdAt: true,
        memberships: {
          where: { status: "active", OR: [{ role: "technician" }, { role: "tecnico" }] },
          select: { id: true },
        },
        subscription: true,
      },
    });

    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    return res.json(buildBillingContext({
      workspaceId: workspace.id,
      workspaceCreatedAt: workspace.createdAt,
      technicianCount: workspace.memberships.length,
      subscription: workspace.subscription,
    }));
  } catch (error) {
    return next(error);
  }
});

workspaceRouter.get("/:workspaceId/members", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const paramsSchema = z.object({
      workspaceId: z.string().uuid(),
    });
    const { workspaceId } = paramsSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);

    const access = await resolveWorkspaceAccess(req.auth!.userId, workspaceId);
    if (!access.appUser) {
      return res.status(404).json({ message: "App user not found." });
    }
    if (!access.canAccess || !access.workspace) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const members = await prisma.membership.findMany({
      where: { workspaceId },
      select: {
        id: true,
        role: true,
        status: true,
        userId: true,
        user: {
          select: {
            id: true,
            authUserId: true,
            name: true,
            email: true,
            phone: true,
            workspaceId: true,
            ownedWorkspaces: {
              select: {
                id: true,
              },
            },
            user: {
              select: {
                id: true,
                isActive: true,
                fullName: true,
                profile: {
                  select: {
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    const lastSeenByAuthUserId = await loadLastSeenByAuthUserIds(
      members.map((membership: (typeof members)[number]) => membership.user.authUserId),
    );

    return res.json({
      workspace: {
        id: access.workspace.id,
        name: access.workspace.name,
        owner_app_user_id: access.workspace.ownerUserId,
      },
      members: members.map((membership: (typeof members)[number]) => {
        const normalizedRole = normalizeWorkspaceRole(membership.role);
        const isWorkspaceOwner = membership.userId === access.workspace!.ownerUserId;
        const effectiveRole = isWorkspaceOwner ? "owner" : normalizedRole ?? membership.role;
        const isActive = membership.status === "active" && membership.user.user?.isActive !== false;

        return {
          membership_id: membership.id,
          app_user_id: membership.userId,
          auth_user_id: membership.user.authUserId,
          name: membership.user.name ?? membership.user.user?.fullName ?? null,
          email: membership.user.email,
          phone: membership.user.phone,
          role: effectiveRole,
          role_label: toWorkspaceRoleLabel(normalizedRole, isWorkspaceOwner),
          status: isActive ? "active" : "inactive",
          membership_status: membership.status,
          avatar_url: membership.user.user?.profile?.avatarUrl ?? null,
          last_access_at: lastSeenByAuthUserId.get(membership.user.authUserId) ?? null,
          is_workspace_owner: isWorkspaceOwner,
          has_own_workspace: membership.user.ownedWorkspaces.length > 0,
          owned_workspace_count: membership.user.ownedWorkspaces.length,
          current_workspace_id: membership.user.workspaceId ?? null,
        };
      }),
    });
  } catch (error) {
    return next(error);
  }
});

workspaceRouter.post("/:workspaceId/members", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const paramsSchema = z.object({
      workspaceId: z.string().uuid(),
    });
    const { workspaceId } = paramsSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const input = createWorkspaceMemberSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const access = await resolveWorkspaceAccess(req.auth!.userId, workspaceId);

    if (!access.appUser) {
      return res.status(404).json({ message: "App user not found." });
    }
    if (!access.workspace || !access.canManageMembers) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const normalizedRole = normalizeWorkspaceRole(input.role);
    if (!normalizedRole) {
      return res.status(400).json({ message: "Invalid role." });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existingUser) {
      return res.status(409).json({ message: "Já existe um utilizador com este e-mail. Use o fluxo de convite para adicionar uma conta existente." });
    }

    const tempPassword = buildTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const displayCode = await generateDisplayCode(normalizedRole);

    const member = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const createdUser = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          fullName: input.fullName.trim(),
          role: "user",
        },
        select: {
          id: true,
          email: true,
          fullName: true,
        },
      });

      const createdAppUser = await tx.appUser.create({
        data: {
          authUserId: createdUser.id,
          email: createdUser.email,
          name: createdUser.fullName,
          workspaceId,
        },
        select: {
          id: true,
        },
      });

      await tx.profile.create({
        data: {
          id: createdUser.id,
          fullName: createdUser.fullName,
          email: createdUser.email,
          displayCode,
        },
      });

      await tx.userRole.create({
        data: {
          userId: createdUser.id,
          role: "user",
        },
      });

      const membership = await tx.membership.create({
        data: {
          workspaceId,
          userId: createdAppUser.id,
          role: normalizedRole,
          status: "active",
          source: "workspace_member_create",
        },
      });

      return {
        membershipId: membership.id,
        appUserId: createdAppUser.id,
        authUserId: createdUser.id,
        email: createdUser.email,
        fullName: createdUser.fullName,
      };
    });

    return res.status(201).json({
      member: {
        membership_id: member.membershipId,
        app_user_id: member.appUserId,
        auth_user_id: member.authUserId,
        email: member.email,
        name: member.fullName,
        role: normalizedRole,
        role_label: toWorkspaceRoleLabel(normalizedRole),
        workspace_id: workspaceId,
      },
      temp_password: tempPassword,
    });
  } catch (error) {
    return next(error);
  }
});

workspaceRouter.patch("/:workspaceId/members/:membershipId", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const paramsSchema = z.object({
      workspaceId: z.string().uuid(),
      membershipId: z.string().uuid(),
    });
    const { workspaceId, membershipId } = paramsSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const input = updateWorkspaceMemberSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const access = await resolveWorkspaceAccess(req.auth!.userId, workspaceId);

    if (!access.appUser) {
      return res.status(404).json({ message: "App user not found." });
    }
    if (!access.workspace || !access.canManageMembers) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const membership = await prisma.membership.findFirst({
      where: {
        id: membershipId,
        workspaceId,
      },
      select: {
        id: true,
        userId: true,
        role: true,
        status: true,
        user: {
          select: {
            authUserId: true,
          },
        },
      },
    });

    if (!membership) {
      return res.status(404).json({ message: "Member not found." });
    }

    const isWorkspaceOwner = membership.userId === access.workspace.ownerUserId;
    if (isWorkspaceOwner) {
      return res.status(409).json({ message: "O owner do workspace não pode ser alterado a partir desta tela." });
    }

    const normalizedRole = input.role ? normalizeWorkspaceRole(input.role) : null;
    if (input.role && !normalizedRole) {
      return res.status(400).json({ message: "Invalid role." });
    }

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const nextMembership = await updateMemberMembershipOnly(tx, membership.id, {
        role: normalizedRole,
        status: input.status,
      });

      return nextMembership;
    });

    return res.json({
      member: {
        membership_id: updated.id,
        role: normalizedRole ?? normalizeWorkspaceRole(updated.role) ?? updated.role,
        role_label: toWorkspaceRoleLabel(normalizedRole ?? normalizeWorkspaceRole(updated.role)),
        status: updated.status === "active" ? "active" : "inactive",
      },
    });
  } catch (error) {
    return next(error);
  }
});
