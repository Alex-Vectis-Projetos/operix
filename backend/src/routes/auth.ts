import { Router, type NextFunction, type Request, type Response } from "express";
import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { generateDisplayCode } from "../lib/displayCode.js";
import { signAccessToken } from "../lib/jwt.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { isEmailConfigured, sendEmail } from "../lib/email/resend.js";
import { passwordResetEmail, welcomeEmail } from "../lib/email/templates.js";

export const registerSchema = z.object({
  email: z.string().email().transform((value: string) => value.trim().toLowerCase()),
  password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres."),
  fullName: z.string().min(2, "Informe o nome completo."),
  role: z.enum(["user", "technician", "client"]).default("user"),
});

const loginSchema = z.object({
  email: z.string().email().transform((value: string) => value.trim().toLowerCase()),
  password: z.string().min(1, "A senha é obrigatória."),
});

const changePasswordSchema = z.object({
  password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres."),
});

const recoverSchema = z.object({
  email: z.string().email().transform((value: string) => value.trim().toLowerCase()),
});

const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres."),
});

export const authRouter = Router();

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function resolvePublicAppUrl() {
  const u = (env.PUBLIC_APP_URL || "").trim();
  if (u) return u.replace(/\/$/, "");
  const origin = (env.CORS_ORIGIN || "").split(",")[0]?.trim() || "http://localhost:8080";
  return origin.replace(/\/$/, "");
}

authRouter.post("/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = registerSchema.parse(req.body);
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    if (existingUser) {
      return res.status(409).json({ message: "Já existe um usuário com este e-mail." });
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const displayCode = await generateDisplayCode(input.role);
    const user = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const createdUser = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          role: "user",
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          createdAt: true,
        },
      });

      await tx.appUser.create({
        data: {
          authUserId: createdUser.id,
          email: createdUser.email,
          name: createdUser.fullName,
        },
      });

      await tx.profile.create({
        data: {
          id: createdUser.id,
          fullName: createdUser.fullName,
          email: createdUser.email,
          displayCode,
          isSystemOwner: false,
        },
      });

      await tx.userRole.create({
        data: {
          userId: createdUser.id,
          role: input.role,
        },
      });

      return createdUser;
    });

    const token = signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    if (isEmailConfigured()) {
      try {
        const tpl = welcomeEmail({ fullName: user.fullName });
        const r = await sendEmail({
          to: user.email,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
        });
        await prisma.backendEventLog.create({
          data: {
            tableName: "users",
            rowId: user.id,
            action: r.ok ? "auth.welcome_email.sent" : "auth.welcome_email.failed",
            actorUserId: user.id,
            payload: {
              provider: r.provider,
              ok: r.ok,
              ...(r.ok ? { email_id: r.id } : { error: r.error }),
            } as Prisma.InputJsonValue,
          },
        });
      } catch (e) {
        console.error("[auth.register] welcome email error", e);
      }
    }

    return res.status(201).json({
      token,
      user,
    });
  } catch (error) {
    return next(error);
  }
});

authRouter.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Credenciais inválidas." });
    }

    const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ message: "Credenciais inválidas." });
    }

    const token = signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

authRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth?.userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado." });
    }

    return res.json({ user });
  } catch (error) {
    return next(error);
  }
});

authRouter.post("/change-password", requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const input = changePasswordSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);

    const passwordHash = await bcrypt.hash(input.password, 12);
    await prisma.user.update({
      where: { id: req.auth?.userId },
      data: { passwordHash },
    });

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

authRouter.post("/recover", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = recoverSchema.parse(req.body);
    const alwaysOk = () => res.status(204).send();

    if (!isEmailConfigured()) {
      return alwaysOk();
    }

    const user = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true, fullName: true, passwordHash: true, isActive: true },
    });
    if (!user || !user.isActive) {
      return alwaysOk();
    }

    const token = jwt.sign(
      {
        typ: "pwd_reset",
        sub: user.id,
        email: user.email,
        pw: sha256Hex(user.passwordHash),
      },
      env.JWT_SECRET,
      { expiresIn: "30m" },
    );

    const resetUrl = `${resolvePublicAppUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    const tpl = passwordResetEmail({ fullName: user.fullName, resetUrl });
    const r = await sendEmail({
      to: user.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });

    await prisma.backendEventLog.create({
      data: {
        tableName: "users",
        rowId: user.id,
        action: r.ok ? "auth.password_reset_email.sent" : "auth.password_reset_email.failed",
        actorUserId: null,
        payload: {
          provider: r.provider,
          ok: r.ok,
          ...(r.ok ? { email_id: r.id } : { error: r.error }),
        } as Prisma.InputJsonValue,
      },
    });

    return alwaysOk();
  } catch (error) {
    return next(error);
  }
});

authRouter.post("/reset-password", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = resetPasswordSchema.parse(req.body);
    const decoded = jwt.verify(input.token, env.JWT_SECRET) as any;
    if (!decoded || decoded.typ !== "pwd_reset" || typeof decoded.sub !== "string" || typeof decoded.email !== "string") {
      return res.status(400).json({ message: "Token inválido." });
    }
    const expectedPw = typeof decoded.pw === "string" ? decoded.pw : null;
    if (!expectedPw) return res.status(400).json({ message: "Token inválido." });

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, email: true, passwordHash: true, isActive: true },
    });
    if (!user || !user.isActive || user.email !== decoded.email) {
      return res.status(400).json({ message: "Token inválido." });
    }
    if (sha256Hex(user.passwordHash) !== expectedPw) {
      return res.status(400).json({ message: "Token expirado ou já utilizado." });
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    await prisma.backendEventLog.create({
      data: {
        tableName: "users",
        rowId: user.id,
        action: "auth.password_reset.completed",
        actorUserId: user.id,
        payload: { via: "email_link" } as Prisma.InputJsonValue,
      },
    });

    return res.status(204).send();
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && (error as any).name === "JsonWebTokenError") {
      return res.status(400).json({ message: "Token inválido." });
    }
    if (error && typeof error === "object" && "name" in error && (error as any).name === "TokenExpiredError") {
      return res.status(400).json({ message: "Token expirado." });
    }
    return next(error);
  }
});
