export type PermissionScope = "own" | "team" | "all";
export type PermissionSource = "admin" | "role" | "default-deny";
export type PermissionRole = "owner" | "admin" | "partner" | "technician" | "client";

export interface PermissionEntry {
  allowed: boolean;
  scope: PermissionScope | null;
  source: PermissionSource;
}

const KNOWN_PERMISSION_KEYS = [
  "dashboard.view",
  "dashboard.view_dashboard",
  "dashboard.report_hail",
  "dashboard.edit",
  "service_orders.view",
  "service_orders.create",
  "service_orders.edit",
  "service_orders.delete",
  "service_orders.export_pdf",
  "service_orders.scan_document",
  "service_orders.upload_document",
  "service_orders.validate_data",
  "service_orders.assign_technician",
  "payment_orders.view",
  "payment_orders.create",
  "payment_orders.edit",
  "payment_orders.delete",
  "payment_orders.export_pdf",
  "payment_orders.scan_document",
  "payment_orders.upload_document",
  "payment_orders.validate_data",
  "payment_orders.assign_technician",
  "accounting.view",
  "accounting.create",
  "accounting.edit",
  "accounting.delete",
  "financial.view",
  "financial.edit",
  "financial.view_reports",
  "financial.export_reports",
  "profit.view",
  "profit.create",
  "profit.edit",
  "profit.delete",
  "fleet.view",
  "fleet.create",
  "fleet.edit",
  "fleet.delete",
  "fleet.export_reports",
  "documents.view",
  "documents.create",
  "documents.upload",
  "documents.edit",
  "documents.delete",
  "users.view",
  "users.create",
  "users.edit",
  "users.delete",
  "users.view_permissions",
  "users.manage_permissions",
  "users.impersonate",
  "marketplace.view",
  "marketplace.create",
  "marketplace.edit",
  "marketplace.delete",
  "subscriptions.view",
  "subscriptions.view_history",
  "subscriptions.view_payments",
  "subscriptions.export_invoices",
  "subscriptions.change_plan",
  "subscriptions.cancel",
  "subscriptions.manage_billing",
  "settings.view",
  "settings.edit",
  "settings.change_password",
  "profile.view",
  "profile.edit",
  "notifications.view",
  "notifications.mark_read",
  "production_workflow.view",
  "production_workflow.move",
  "locations.view",
  "locations.create",
  "locations.edit",
  "locations.delete",
  "people.view",
  "people.create",
  "people.edit",
  "people.delete",
  "people.upload_document",
  "country_document_requirements.view",
  "country_document_requirements.edit",
] as const;

type Rule = {
  module: string;
  actions: string[] | "*";
  scope?: PermissionScope;
};

const OWNER_RULES: Rule[] = [
  { module: "dashboard", actions: "*", scope: "all" },
  { module: "service_orders", actions: "*", scope: "all" },
  { module: "payment_orders", actions: "*", scope: "all" },
  { module: "accounting", actions: "*", scope: "all" },
  { module: "financial", actions: "*", scope: "all" },
  { module: "profit", actions: "*", scope: "all" },
  { module: "fleet", actions: "*", scope: "all" },
  { module: "documents", actions: "*", scope: "all" },
  { module: "users", actions: "*", scope: "all" },
  { module: "marketplace", actions: "*", scope: "all" },
  { module: "subscriptions", actions: "*", scope: "all" },
  { module: "settings", actions: "*", scope: "all" },
  { module: "profile", actions: "*", scope: "all" },
  { module: "notifications", actions: "*", scope: "all" },
  { module: "production_workflow", actions: "*", scope: "all" },
  { module: "locations", actions: "*", scope: "all" },
  { module: "people", actions: "*", scope: "all" },
  { module: "country_document_requirements", actions: "*", scope: "all" },
];

const ROLE_RULES: Record<Exclude<PermissionRole, "owner">, Rule[]> = {
  admin: [
    { module: "dashboard", actions: "*", scope: "all" },
    { module: "service_orders", actions: "*", scope: "all" },
    { module: "payment_orders", actions: "*", scope: "all" },
    { module: "accounting", actions: "*", scope: "all" },
    { module: "financial", actions: "*", scope: "all" },
    { module: "profit", actions: "*", scope: "all" },
    { module: "fleet", actions: "*", scope: "all" },
    { module: "documents", actions: "*", scope: "all" },
    { module: "users", actions: ["view", "create", "edit", "delete", "view_permissions"], scope: "all" },
    { module: "marketplace", actions: "*", scope: "all" },
    { module: "subscriptions", actions: ["view", "view_history", "view_payments", "export_invoices"], scope: "all" },
    { module: "settings", actions: "*", scope: "all" },
    { module: "profile", actions: "*", scope: "all" },
    { module: "notifications", actions: "*", scope: "all" },
    { module: "production_workflow", actions: "*", scope: "all" },
    { module: "locations", actions: "*", scope: "all" },
    { module: "people", actions: "*", scope: "all" },
    { module: "country_document_requirements", actions: "*", scope: "all" },
  ],
  partner: [
    { module: "dashboard", actions: ["view", "view_dashboard", "report_hail"], scope: "team" },
    { module: "service_orders", actions: ["view", "create", "edit", "export_pdf", "scan_document", "upload_document", "validate_data"], scope: "team" },
    { module: "payment_orders", actions: ["view", "create", "edit", "export_pdf", "scan_document", "upload_document", "validate_data"], scope: "team" },
    { module: "accounting", actions: ["view", "create", "edit"], scope: "team" },
    { module: "financial", actions: ["view", "view_reports", "export_reports"], scope: "team" },
    { module: "profit", actions: ["view"], scope: "team" },
    { module: "fleet", actions: ["view"], scope: "team" },
    { module: "documents", actions: ["view", "create", "upload", "edit"], scope: "team" },
    { module: "users", actions: ["view"], scope: "team" },
    { module: "marketplace", actions: ["view"], scope: "team" },
    { module: "subscriptions", actions: ["view", "view_history", "view_payments"], scope: "team" },
    { module: "settings", actions: ["view"], scope: "own" },
    { module: "profile", actions: "*", scope: "own" },
    { module: "notifications", actions: ["view", "mark_read"], scope: "own" },
    // Move is further restricted at the route level to pre-faturamento transitions only (FR-016).
    { module: "production_workflow", actions: ["view", "move"], scope: "team" },
    { module: "locations", actions: ["view"], scope: "team" },
    { module: "people", actions: ["view", "create", "edit", "upload_document"], scope: "team" },
    { module: "country_document_requirements", actions: ["view"], scope: "team" },
  ],
  technician: [
    { module: "dashboard", actions: ["view", "view_dashboard"], scope: "own" },
    { module: "service_orders", actions: ["view", "create", "edit", "scan_document", "upload_document"], scope: "own" },
    { module: "payment_orders", actions: ["view"], scope: "own" },
    { module: "financial", actions: ["view"], scope: "own" },
    { module: "fleet", actions: ["view"], scope: "own" },
    { module: "documents", actions: ["view", "upload"], scope: "own" },
    { module: "subscriptions", actions: ["view"], scope: "own" },
    { module: "settings", actions: ["view", "edit", "change_password"], scope: "own" },
    { module: "profile", actions: "*", scope: "own" },
    { module: "notifications", actions: ["view", "mark_read"], scope: "own" },
    { module: "production_workflow", actions: ["view"], scope: "own" },
    { module: "locations", actions: ["view"], scope: "own" },
    { module: "people", actions: ["view", "upload_document"], scope: "own" },
  ],
  client: [
    { module: "dashboard", actions: ["view"], scope: "own" },
    { module: "service_orders", actions: ["view"], scope: "own" },
    { module: "payment_orders", actions: ["view"], scope: "own" },
    { module: "documents", actions: ["view"], scope: "own" },
    { module: "subscriptions", actions: ["view", "view_history", "view_payments"], scope: "own" },
    { module: "settings", actions: ["view", "change_password"], scope: "own" },
    { module: "profile", actions: "*", scope: "own" },
    { module: "notifications", actions: ["view", "mark_read"], scope: "own" },
    { module: "production_workflow", actions: ["view"], scope: "own" },
  ],
};

function ruleAllows(rule: Rule, module: string, action: string) {
  if (rule.module !== module) {
    return false;
  }

  return rule.actions === "*" || rule.actions.includes(action);
}

export function normalizePermissionRole(role: string | null | undefined): PermissionRole | null {
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

export function buildPermissionsForRole(role: string | null | undefined) {
  const normalizedRole = normalizePermissionRole(role);
  const rules = normalizedRole === "owner" ? OWNER_RULES : (normalizedRole ? ROLE_RULES[normalizedRole] : undefined) ?? [];
  const map: Record<string, PermissionEntry> = {};

  for (const key of KNOWN_PERMISSION_KEYS) {
    const [module, action] = key.split(".");
    const matchingRule = rules.find((rule) => ruleAllows(rule, module, action));

    map[key] = matchingRule
      ? {
          allowed: true,
          scope: matchingRule.scope ?? "all",
          source: "role",
        }
      : {
          allowed: false,
          scope: null,
          source: "default-deny",
        };
  }

  return {
    admin: normalizedRole === "owner",
    map,
  };
}
