import jwt, { type SignOptions } from "jsonwebtoken";
import type { User } from "@prisma/client";
import { env } from "../config/env.js";

export interface AuthTokenPayload {
  sub: string;
  email: string;
  role: string;
}

export function signAccessToken(user: Pick<User, "id" | "email" | "role">) {
  const payload: AuthTokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
  };

  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  };

  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
}

export interface BudgetSigningTokenPayload {
  budgetId: string;
  revisionId: string;
  workspaceId: string;
  purpose: "budget_public_sign";
}

export function signBudgetApprovalToken(
  payload: { budgetId: string; revisionId: string; workspaceId: string },
  expiresIn = "30d"
): string {
  return jwt.sign(
    {
      budgetId: payload.budgetId,
      revisionId: payload.revisionId,
      workspaceId: payload.workspaceId,
      purpose: "budget_public_sign",
    },
    env.JWT_SECRET,
    { expiresIn: expiresIn as any }
  );
}

export function verifyBudgetApprovalToken(token: string): {
  budgetId: string;
  revisionId: string;
  workspaceId: string;
} {
  const decoded = jwt.verify(token, env.JWT_SECRET) as any;
  if (
    !decoded ||
    decoded.purpose !== "budget_public_sign" ||
    !decoded.budgetId ||
    !decoded.revisionId ||
    !decoded.workspaceId
  ) {
    throw new Error("TOKEN_INVALID: Token de assinatura inválido ou expirado.");
  }
  return {
    budgetId: decoded.budgetId,
    revisionId: decoded.revisionId,
    workspaceId: decoded.workspaceId,
  };
}
