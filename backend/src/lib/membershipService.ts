import type { Prisma } from "@prisma/client";

export type NormalizedWorkspaceRole = "owner" | "admin" | "partner" | "technician" | "client";

export function normalizeWorkspaceRole(role: string | null | undefined): NormalizedWorkspaceRole | null {
  switch ((role ?? "").trim().toLowerCase()) {
    case "owner":
      return "owner";
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

export function toWorkspaceRoleLabel(role: NormalizedWorkspaceRole | null, isWorkspaceOwner = false): string {
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

/**
 * Serviço de atualização de membros de workspace.
 * 
 * Invariante de Segurança (S5A-002 / Spec 001):
 * A alteração do papel de um membro dentro de um Workspace NUNCA deve
 * propagar ou modificar o papel global (User.role / UserRole) do usuário.
 */
export async function updateMemberMembershipOnly(
  tx: Prisma.TransactionClient,
  membershipId: string,
  data: {
    role?: string | null;
    status?: string;
  }
) {
  return tx.membership.update({
    where: { id: membershipId },
    data: {
      role: data.role ?? undefined,
      status: data.status ?? undefined,
    },
    select: {
      id: true,
      role: true,
      status: true,
      userId: true,
      workspaceId: true,
    },
  });
}
