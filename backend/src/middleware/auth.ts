import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { verifyAccessToken } from "../lib/jwt.js";

export interface AuthenticatedRequest extends Request {
  auth?: {
    userId: string;
    email: string;
    role: string;
  };
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  let token: string | undefined;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    token = header.slice("Bearer ".length);
  } else if (typeof req.query.token === "string" && req.query.token.trim()) {
    token = req.query.token.trim();
  } else if (typeof req.query.auth_token === "string" && req.query.auth_token.trim()) {
    token = req.query.auth_token.trim();
  }

  if (!token) {
    return res.status(401).json({ message: "Token JWT ausente ou inválido." });
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Usuário não encontrado ou inativo." });
    }

    req.auth = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    return next();
  } catch {
    return res.status(401).json({ message: "Token JWT inválido ou expirado." });
  }
}
