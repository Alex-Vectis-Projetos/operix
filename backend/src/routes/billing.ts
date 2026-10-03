import { Router, type NextFunction, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { operationalBillingRouter } from "./billingOperations.js";
import { createStripeClient, getConfiguredStripeEnvironment, type StripeEnv, verifyStripeWebhookSignature } from "../lib/stripe.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { WORKSPACE_TIERS, findWorkspaceTier } from "../lib/subscription.js";
import { buildSimplePdf } from "../lib/pdf/simplePdf.js";
import { isEmailConfigured, sendEmail } from "../lib/email/resend.js";
import { reportEmail } from "../lib/email/templates.js";

export const billingRouter = Router();

const workspaceIdSchema = z.object({
  workspaceId: z.string().min(1),
});

const billingProfileSchema = z.object({
  legal_name: z.string().min(2).max(200),
  company_name: z.string().max(200).nullable().optional(),
  billing_email: z.string().email(),
  billing_address: z.string().max(500).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  postal_code: z.string().max(50).nullable().optional(),
  country: z.string().min(2).max(2).default("PT"),
  vat_number: z.string().max(50).nullable().optional(),
  is_business: z.boolean().default(true),
  preferred_currency: z.string().min(3).max(3).default("EUR"),
  vat_mode: z.enum(["with_vat", "no_vat", "reverse_charge"]).default("with_vat"),
});

const paymentMethodSchema = z.object({
  kind: z.enum(["card", "sepa", "manual_transfer"]),
  brand: z.string().max(120).nullable().optional(),
  last4: z.string().max(4).nullable().optional(),
  holder_name: z.string().max(200).nullable().optional(),
  iban_masked: z.string().max(64).nullable().optional(),
  is_default: z.boolean().default(true),
});

const manualTransferSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().min(3).max(3).default("EUR"),
  invoice_id: z.string().max(100).optional().nullable(),
  bank_account_id: z.string().uuid().optional().nullable(),
  payment_method: z.string().max(50).default("bank_transfer"),
  transfer_date: z.string().datetime().optional().nullable(),
  proof_path: z.string().max(2_000_000).optional().nullable(),
  proof_name: z.string().max(255).optional().nullable(),
  notes: z.string().max(2_000).optional().nullable(),
});

const vatCalcSchema = z.object({
  country: z.string().min(2).max(2),
  is_business: z.boolean(),
  vat_number: z.string().max(50).optional().nullable(),
});

const previewInvoiceSchema = z.object({
  invoice_id: z.string().uuid().optional().nullable(),
  plan_code: z.string().min(2).max(50),
  cycle: z.enum(["monthly", "yearly"]),
  vat_mode: z.enum(["personal", "business"]),
  bank_account_id: z.string().uuid().optional().nullable(),
  amount: z.number().positive(),
  vat_rate: z.number().min(0).max(1).optional().default(0),
  vat_exemption: z.string().max(200).optional().nullable(),
  legal_name: z.string().min(2).max(200),
  billing_email: z.string().email(),
  country: z.string().min(2).max(2),
  vat_number: z.string().max(50).optional().nullable(),
});

const activateSchema = z.object({
  plan_code: z.string().min(2).max(50),
  cycle: z.enum(["monthly", "yearly"]),
});

const checkoutSessionSchema = z.object({
  lookup_key: z.string().min(2).max(120),
  customer_email: z.string().email().optional().nullable(),
  legal_name: z.string().min(2).max(200).optional().nullable(),
  return_url: z.string().url(),
  environment: z.enum(["sandbox", "live"]).optional().nullable(),
});

const manualTransferDecisionSchema = z.object({
  notes: z.string().max(2_000).optional().nullable(),
});

const adminBankAccountPatchSchema = z.object({
  active: z.boolean().optional(),
  iban: z.string().max(80).optional().nullable(),
  bic: z.string().max(40).optional().nullable(),
  account_name: z.string().min(2).max(200).optional(),
  bank_name: z.string().min(2).max(200).optional(),
  is_primary: z.boolean().optional(),
});

const adminLifecycleTransitionSchema = z.object({
  status: z.enum(["active", "grace_period", "past_due", "overdue", "suspended", "cancelled", "legal_hold"]),
  reason: z.string().max(500).optional().nullable(),
  suspension_mode: z.enum(["soft", "hard"]).optional().nullable(),
});

const adminPaymentUpsertSchema = z.object({
  invoice_id: z.string().uuid(),
  payment_method_id: z.string().max(120).optional().nullable(),
  amount: z.number().positive(),
  payment_date: z.string().min(10).max(40),
  reference: z.string().max(255).optional().nullable(),
  notes: z.string().max(2_000).optional().nullable(),
  status: z.enum(["pending", "confirmed", "failed", "refunded"]),
  account: z.string().max(255).optional().nullable(),
  proof_path: z.string().max(2_000_000).optional().nullable(),
  proof_name: z.string().max(255).optional().nullable(),
});

billingRouter.post("/webhooks/stripe", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const querySchema = z.object({
      env: z.enum(["sandbox", "live"]),
    });
    const { env: stripeEnv } = querySchema.parse(req.query);
    const signature = req.headers["stripe-signature"];
    const rawBody = (req as typeof req & { rawBody?: string }).rawBody;

    if (!signature || Array.isArray(signature) || !rawBody) {
      return res.status(400).send("Webhook signature missing.");
    }

    const event = await verifyStripeWebhookSignature({
      payload: rawBody,
      signature,
      environment: stripeEnv,
    });

    const stripeStatusMap: Record<string, string> = {
      trialing: "trial",
      active: "active",
      past_due: "overdue",
      unpaid: "overdue",
      incomplete: "trial",
      incomplete_expired: "cancelled",
      canceled: "cancelled",
      paused: "suspended",
    };

    const resolveWorkspaceByCustomer = async (customerId: string | null) => {
      if (!customerId) {
        return null;
      }

      const subscription = await prisma.workspaceSubscription.findFirst({
        where: { stripeCustomerId: customerId },
        select: { workspaceId: true },
      });

      return subscription?.workspaceId ?? null;
    };

    const handleWorkspaceSubscriptionUpsert = async (subscriptionPayload: Record<string, any>, environment: StripeEnv) => {
      const item = subscriptionPayload.items?.data?.[0];
      const lookupKey = item?.price?.lookup_key ?? null;
      const workspaceId =
        subscriptionPayload.metadata?.workspaceId ??
        (await resolveWorkspaceByCustomer(subscriptionPayload.customer ?? null));

      if (!workspaceId) {
        return;
      }

      const periodStart = item?.current_period_start ?? subscriptionPayload.current_period_start;
      const periodEnd = item?.current_period_end ?? subscriptionPayload.current_period_end;
      const status = stripeStatusMap[subscriptionPayload.status] ?? "active";

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.workspaceSubscription.upsert({
          where: { workspaceId },
          update: {
            status,
            stripeSubscriptionId: subscriptionPayload.id ?? null,
            stripeCustomerId: subscriptionPayload.customer ?? null,
            stripePriceLookupKey: lookupKey,
            stripeEnvironment: environment,
            currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
            currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
            cancelledAt: subscriptionPayload.canceled_at ? new Date(subscriptionPayload.canceled_at * 1000) : null,
            lastRecalculatedAt: new Date(),
          },
          create: {
            workspaceId,
            planCode: typeof lookupKey === "string" ? lookupKey.replace(/_(monthly|yearly)$/, "") : "starter",
            status,
            billingCycle: typeof lookupKey === "string" && lookupKey.endsWith("_yearly") ? "yearly" : "monthly",
            trialStartedAt: new Date(),
            trialEndsAt: null,
            currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
            currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
            cancelledAt: subscriptionPayload.canceled_at ? new Date(subscriptionPayload.canceled_at * 1000) : null,
            stripeSubscriptionId: subscriptionPayload.id ?? null,
            stripeCustomerId: subscriptionPayload.customer ?? null,
            stripePriceLookupKey: lookupKey,
            stripeEnvironment: environment,
            lastRecalculatedAt: new Date(),
          },
        });

        await logSubscriptionEvent(tx, workspaceId, {
          eventType: `stripe.subscription.${subscriptionPayload.status ?? "updated"}`,
          severity: "info",
          message: `Stripe: subscription ${subscriptionPayload.status ?? "updated"}.`,
          metadata: {
            stripe_subscription_id: subscriptionPayload.id ?? null,
            stripe_customer_id: subscriptionPayload.customer ?? null,
            lookup_key: lookupKey,
          },
        });
      });
    };

    const handleWorkspaceSubscriptionDeleted = async (subscriptionPayload: Record<string, any>) => {
      const workspaceId =
        subscriptionPayload.metadata?.workspaceId ??
        (await resolveWorkspaceByCustomer(subscriptionPayload.customer ?? null));

      if (!workspaceId) {
        return;
      }

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.workspaceSubscription.updateMany({
          where: { workspaceId },
          data: {
            status: "cancelled",
            cancelledAt: new Date(),
            lastRecalculatedAt: new Date(),
          },
        });

        await logSubscriptionEvent(tx, workspaceId, {
          eventType: "stripe.subscription.deleted",
          severity: "warning",
          message: "Stripe: subscription cancelled.",
          metadata: {
            stripe_subscription_id: subscriptionPayload.id ?? null,
          },
        });
      });
    };

    const handleInvoicePaid = async (invoicePayload: Record<string, any>) => {
      const workspaceId =
        invoicePayload.subscription_details?.metadata?.workspaceId ??
        invoicePayload.metadata?.workspaceId ??
        (await resolveWorkspaceByCustomer(invoicePayload.customer ?? null));

      if (!workspaceId) {
        return;
      }

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const matchedInvoice = await tx.platformInvoice.findFirst({
          where: {
            workspaceId,
            OR: [
              { id: invoicePayload.metadata?.platform_invoice_id ?? undefined },
              {
                metadata: {
                  path: ["stripe_invoice_id"],
                  equals: invoicePayload.id ?? null,
                },
              },
            ],
          },
        });

        if (matchedInvoice) {
          const metadata = asJsonRecord(matchedInvoice.metadata);
          await tx.platformInvoice.update({
            where: { id: matchedInvoice.id },
            data: {
              status: "paid",
              paidAt: new Date(),
              metadata: {
                ...(metadata ?? {}),
                stripe_invoice_id: invoicePayload.id ?? null,
                stripe_payment_intent_id: invoicePayload.payment_intent ?? null,
              } as Prisma.InputJsonValue,
            },
          });
        }

        await logSubscriptionEvent(tx, workspaceId, {
          eventType: "stripe.invoice.paid",
          severity: "success",
          message: `Stripe: pagamento recebido (${((invoicePayload.amount_paid ?? 0) / 100).toFixed(2)} ${(invoicePayload.currency ?? "eur").toUpperCase()}).`,
          metadata: {
            stripe_invoice_id: invoicePayload.id ?? null,
            hosted_invoice_url: invoicePayload.hosted_invoice_url ?? null,
          },
        });
      });
    };

    const handleInvoiceFailed = async (invoicePayload: Record<string, any>) => {
      const workspaceId =
        invoicePayload.subscription_details?.metadata?.workspaceId ??
        invoicePayload.metadata?.workspaceId ??
        (await resolveWorkspaceByCustomer(invoicePayload.customer ?? null));

      if (!workspaceId) {
        return;
      }

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await logSubscriptionEvent(tx, workspaceId, {
          eventType: "stripe.invoice.failed",
          severity: "warning",
          message: "Stripe: pagamento falhou.",
          metadata: {
            stripe_invoice_id: invoicePayload.id ?? null,
            attempt_count: invoicePayload.attempt_count ?? null,
            next_payment_attempt: invoicePayload.next_payment_attempt ?? null,
          },
        });
      });
    };

    const handleCheckoutCompleted = async (sessionPayload: Record<string, any>) => {
      const workspaceId =
        sessionPayload.metadata?.workspaceId ??
        (await resolveWorkspaceByCustomer(sessionPayload.customer ?? null));

      if (!workspaceId) {
        return;
      }

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.workspaceSubscription.upsert({
          where: { workspaceId },
          update: {
            stripeCustomerId: sessionPayload.customer ?? null,
            stripeEnvironment: stripeEnv,
            lastRecalculatedAt: new Date(),
          },
          create: {
            workspaceId,
            planCode: "starter",
            status: "trial",
            billingCycle: "monthly",
            trialStartedAt: new Date(),
            trialEndsAt: addDays(new Date(), 14),
            stripeCustomerId: sessionPayload.customer ?? null,
            stripeEnvironment: stripeEnv,
            lastRecalculatedAt: new Date(),
          },
        });

        await logSubscriptionEvent(tx, workspaceId, {
          eventType: "stripe.checkout.completed",
          severity: "info",
          message: "Stripe: checkout concluido.",
          metadata: {
            session_id: sessionPayload.id ?? null,
            mode: sessionPayload.mode ?? null,
            amount_total: sessionPayload.amount_total ? sessionPayload.amount_total / 100 : null,
          },
        });
      });
    };

    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleWorkspaceSubscriptionUpsert(event.data.object as Record<string, any>, stripeEnv);
        break;
      case "customer.subscription.deleted":
        await handleWorkspaceSubscriptionDeleted(event.data.object as Record<string, any>);
        break;
      case "invoice.paid":
      case "invoice.payment_succeeded":
        await handleInvoicePaid(event.data.object as Record<string, any>);
        break;
      case "invoice.payment_failed":
        await handleInvoiceFailed(event.data.object as Record<string, any>);
        break;
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Record<string, any>);
        break;
      default:
        break;
    }

    return res.json({ received: true });
  } catch (error) {
    return next(error);
  }
});

billingRouter.use(requireAuth);
billingRouter.use(operationalBillingRouter);

const VAT_RULES = [
  { id: "PT", country: "PT", standard_rate: 23, eu_member: true, reverse_charge_when_business: false },
  { id: "ES", country: "ES", standard_rate: 21, eu_member: true, reverse_charge_when_business: true },
  { id: "FR", country: "FR", standard_rate: 20, eu_member: true, reverse_charge_when_business: true },
  { id: "IT", country: "IT", standard_rate: 22, eu_member: true, reverse_charge_when_business: true },
  { id: "DE", country: "DE", standard_rate: 19, eu_member: true, reverse_charge_when_business: true },
  { id: "NL", country: "NL", standard_rate: 21, eu_member: true, reverse_charge_when_business: true },
  { id: "BE", country: "BE", standard_rate: 21, eu_member: true, reverse_charge_when_business: true },
  { id: "LU", country: "LU", standard_rate: 17, eu_member: true, reverse_charge_when_business: true },
  { id: "IE", country: "IE", standard_rate: 23, eu_member: true, reverse_charge_when_business: true },
  { id: "AT", country: "AT", standard_rate: 20, eu_member: true, reverse_charge_when_business: true },
] as const;

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addMonths(date: Date, months: number) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function asJsonRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, Prisma.JsonValue>;
}

function computeVat(args: { country: string; isBusiness: boolean; vatNumber?: string | null }) {
  const country = args.country.trim().toUpperCase();
  const vatNumber = args.vatNumber?.trim() || null;
  const euCountries = new Set(["PT", "ES", "FR", "IT", "DE", "NL", "BE", "LU", "IE", "AT"]);

  if (!args.isBusiness) {
    return { rate: 0, reverse_charge: false, exemption: "Consumidor final" };
  }

  if (country === "PT") {
    return { rate: 0.23, reverse_charge: false, exemption: null };
  }

  if (euCountries.has(country) && vatNumber) {
    return { rate: 0, reverse_charge: true, exemption: "Autoliquidacao intracomunitaria" };
  }

  return { rate: 0, reverse_charge: false, exemption: "Exportacao / fora do ambito de IVA" };
}

async function ensureDefaultBankAccounts() {
  const existing = await prisma.platformBankAccount.count();
  if (existing > 0) {
    return;
  }

  await prisma.platformBankAccount.createMany({
    data: [
      {
        bankName: "QWork Business Bank",
        accountName: "QWork Group Lda",
        iban: "PT50000000000000000000000",
        bic: "QWRKPTPL",
        country: "PT",
        currency: "EUR",
        accountType: "business",
        isPrimary: true,
        active: true,
      },
      {
        bankName: "Wise",
        accountName: "QWork Personal",
        iban: "PT51000000000000000000000",
        bic: "TRWIBEB1XXX",
        country: "PT",
        currency: "EUR",
        accountType: "personal",
        isPrimary: true,
        active: true,
      },
    ],
  });
}

function mapPlatformBankAccount(account: {
  id: string;
  bankName: string;
  accountName: string;
  iban: string | null;
  bic: string | null;
  country: string;
  currency: string;
  accountType: string;
  isPrimary: boolean;
  active: boolean;
}) {
  return {
    id: account.id,
    bank_name: account.bankName,
    account_name: account.accountName,
    iban: account.iban,
    bic: account.bic,
    country: account.country,
    currency: account.currency,
    account_type: account.accountType,
    is_primary: account.isPrimary,
    active: account.active,
    supported_methods:
      account.accountType === "personal"
        ? ["bank_transfer"]
        : ["bank_transfer", "sepa_transfer"],
  };
}

type AdminPaymentStatus = "pending" | "confirmed" | "failed" | "refunded";

function mapTransferStatusToAdmin(status: string): AdminPaymentStatus {
  if (status === "confirmed") return "confirmed";
  if (status === "rejected") return "failed";
  if (status === "refunded") return "refunded";
  return "pending";
}

function mapAdminStatusToTransfer(status: AdminPaymentStatus): string {
  if (status === "confirmed") return "confirmed";
  if (status === "failed") return "rejected";
  if (status === "refunded") return "refunded";
  return "pending_manual_review";
}

function extractAccountFromNotes(notes: string | null | undefined) {
  if (!notes) return null;
  const match = notes.match(/(?:^|·)\s*Conta:\s*([^·]+)/i);
  return match?.[1]?.trim() || null;
}

function sanitizePaymentNotes(notes: string | null | undefined) {
  if (!notes) return null;
  const cleaned = notes
    .split("·")
    .map((chunk: string) => chunk.trim())
    .filter((chunk: string) => chunk.length > 0 && !/^Conta:\s*/i.test(chunk))
    .join(" · ");
  return cleaned || null;
}

async function getInvoicePaymentSummary(invoiceIds: string[]) {
  if (invoiceIds.length === 0) {
    return new Map<string, { paidAmount: number; paymentCount: number; lastPaidAt: Date | null }>();
  }

  const transfers = await prisma.manualBankTransfer.findMany({
    where: {
      invoiceId: { in: invoiceIds },
      status: "confirmed",
    },
    select: {
      invoiceId: true,
      amount: true,
      transferDate: true,
      reviewedAt: true,
      updatedAt: true,
    },
  });

  const summary = new Map<string, { paidAmount: number; paymentCount: number; lastPaidAt: Date | null }>();

  for (const transfer of transfers) {
    if (!transfer.invoiceId) continue;
    const current = summary.get(transfer.invoiceId) ?? { paidAmount: 0, paymentCount: 0, lastPaidAt: null };
    const candidateDate = transfer.transferDate ?? transfer.reviewedAt ?? transfer.updatedAt;
    summary.set(transfer.invoiceId, {
      paidAmount: current.paidAmount + Number(transfer.amount ?? 0),
      paymentCount: current.paymentCount + 1,
      lastPaidAt:
        !current.lastPaidAt || candidateDate.getTime() > current.lastPaidAt.getTime()
          ? candidateDate
          : current.lastPaidAt,
    });
  }

  return summary;
}

async function syncPlatformInvoicePaymentState(tx: Prisma.TransactionClient, invoiceId: string) {
  const invoice = await tx.platformInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      total: true,
      status: true,
      metadata: true,
    },
  });

  if (!invoice) {
    return null;
  }

  const confirmedTransfers = await tx.manualBankTransfer.findMany({
    where: {
      invoiceId,
      status: "confirmed",
    },
    select: {
      amount: true,
      transferDate: true,
      reviewedAt: true,
      updatedAt: true,
    },
  });

  const paidAmount = confirmedTransfers.reduce(
    (sum: number, transfer: (typeof confirmedTransfers)[number]) => sum + Number(transfer.amount ?? 0),
    0,
  );
  const remainingAmount = Math.max(0, Number(invoice.total ?? 0) - paidAmount);
  const lastPaidAt = confirmedTransfers.reduce<Date | null>((latest: Date | null, transfer: (typeof confirmedTransfers)[number]) => {
    const candidate = transfer.transferDate ?? transfer.reviewedAt ?? transfer.updatedAt;
    if (!latest || candidate.getTime() > latest.getTime()) {
      return candidate;
    }
    return latest;
  }, null);
  const metadata = asJsonRecord(invoice.metadata);

  return tx.platformInvoice.update({
    where: { id: invoiceId },
    data: {
      status: paidAmount >= Number(invoice.total ?? 0) && Number(invoice.total ?? 0) > 0 ? "paid" : "pending",
      paidAt: paidAmount >= Number(invoice.total ?? 0) && Number(invoice.total ?? 0) > 0 ? lastPaidAt : null,
      metadata: {
        ...(metadata ?? {}),
        paid_amount: Math.round(paidAmount * 100) / 100,
        remaining_amount: Math.round(remainingAmount * 100) / 100,
        payment_count: confirmedTransfers.length,
      } as Prisma.InputJsonValue,
    },
  });
}

function listAdminPaymentMethods() {
  return [
    { id: "bank_transfer", name: "Transferência bancária" },
    { id: "manual_transfer", name: "Transferência manual" },
    { id: "card", name: "Cartão" },
    { id: "sepa", name: "SEPA" },
    { id: "stripe", name: "Stripe" },
  ];
}

async function resolveOrCreateStripeCustomer(args: {
  environment: StripeEnv;
  workspaceId: string;
  customerEmail?: string | null;
  legalName?: string | null;
  authUserId?: string | null;
}) {
  const stripe = createStripeClient(args.environment);
  const metadata = {
    workspaceId: args.workspaceId,
    ...(args.authUserId ? { userId: args.authUserId } : {}),
  };

  const byWorkspace = await stripe.customers.search({
    query: `metadata['workspaceId']:'${args.workspaceId}'`,
    limit: 1,
  });

  if (byWorkspace.data.length > 0) {
    return byWorkspace.data[0].id;
  }

  if (args.customerEmail) {
    const byEmail = await stripe.customers.list({
      email: args.customerEmail,
      limit: 1,
    });

    if (byEmail.data.length > 0) {
      const existing = byEmail.data[0];
      await stripe.customers.update(existing.id, {
        metadata: {
          ...existing.metadata,
          ...metadata,
        },
        ...(args.legalName ? { name: args.legalName } : {}),
      });
      return existing.id;
    }
  }

  const created = await stripe.customers.create({
    ...(args.customerEmail ? { email: args.customerEmail } : {}),
    ...(args.legalName ? { name: args.legalName } : {}),
    metadata,
  });

  return created.id;
}

function inferLifecycleState(metadata: Prisma.JsonValue | null) {
  const record = asJsonRecord(metadata);
  return {
    legal_hold: record?.legal_hold === true,
    suspension_mode:
      typeof record?.suspension_mode === "string"
        ? record.suspension_mode
        : null,
  };
}

function categorizeEvent(eventType: string) {
  if (eventType.startsWith("invoice")) return "invoice";
  if (eventType.startsWith("manual_transfer")) return "manual_transfer";
  if (eventType.startsWith("payment_method")) return "payment_method";
  if (eventType.startsWith("subscription")) return "subscription";
  if (eventType.startsWith("automation")) return "automation";
  return "billing";
}

async function listAdminSubscriptions() {
  const subscriptions = await prisma.workspaceSubscription.findMany({
    include: {
      workspace: {
        select: {
          name: true,
          memberships: {
            where: {
              status: "active",
              role: "technician",
            },
            select: { id: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const workspaceIds = subscriptions.map((subscription: (typeof subscriptions)[number]) => subscription.workspaceId);
  const lifecycleEvents = workspaceIds.length
    ? await prisma.subscriptionEvent.findMany({
        where: {
          workspaceId: { in: workspaceIds },
          eventType: "subscription_status_changed",
        },
        orderBy: [{ workspaceId: "asc" }, { createdAt: "desc" }],
      })
    : [];

  const lifecycleByWorkspace = new Map<string, ReturnType<typeof inferLifecycleState>>();
  for (const event of lifecycleEvents) {
    if (!lifecycleByWorkspace.has(event.workspaceId)) {
      lifecycleByWorkspace.set(event.workspaceId, inferLifecycleState(event.metadata));
    }
  }

  return subscriptions.map((subscription: (typeof subscriptions)[number]) => {
    const technicianCount = subscription.workspace.memberships.length;
    const tier = findWorkspaceTier(subscription.planCode, technicianCount);
    const lifecycle = lifecycleByWorkspace.get(subscription.workspaceId) ?? {
      legal_hold: false,
      suspension_mode: null,
    };

    return {
      id: subscription.id,
      workspace_id: subscription.workspaceId,
      status: subscription.status,
      billing_cycle: subscription.billingCycle,
      plan_code: subscription.planCode,
      trial_ends_at: subscription.trialEndsAt?.toISOString() ?? null,
      current_period_end: subscription.currentPeriodEnd?.toISOString() ?? null,
      created_at: subscription.createdAt.toISOString(),
      technician_count: technicianCount,
      current_price:
        subscription.billingCycle === "yearly" ? tier.yearly_price : tier.base_price_monthly,
      suspension_mode: lifecycle.suspension_mode,
      legal_hold: lifecycle.legal_hold,
      workspaces: {
        name: subscription.workspace.name,
      },
    };
  });
}

async function buildPlatformFinancialOverview() {
  const subscriptions = await listAdminSubscriptions();
  const invoices = await prisma.platformInvoice.findMany({
    select: {
      status: true,
      total: true,
      createdAt: true,
    },
  });
  const payments = await prisma.manualBankTransfer.findMany({
    select: {
      status: true,
    },
  });

  const active = subscriptions.filter((subscription: (typeof subscriptions)[number]) => subscription.status === "active");
  const trial = subscriptions.filter((subscription: (typeof subscriptions)[number]) => subscription.status === "trial");
  const cancelled = subscriptions.filter((subscription: (typeof subscriptions)[number]) => subscription.status === "cancelled");
  const mrr = active.reduce((sum: number, subscription: (typeof active)[number]) => {
    return (
      sum +
      (subscription.billing_cycle === "yearly"
        ? subscription.current_price / 12
        : subscription.current_price)
    );
  }, 0);
  const arr = mrr * 12;
  const failed = payments.filter((payment: (typeof payments)[number]) => payment.status === "rejected").length;
  const overdue = invoices.filter((invoice: (typeof invoices)[number]) => invoice.status === "overdue").length;
  const trialConv = active.length + trial.length > 0
    ? Math.round((active.length / (active.length + trial.length)) * 100)
    : 0;
  const recentMrr = active
    .filter((subscription: (typeof active)[number]) => {
      const createdAt = new Date(subscription.created_at);
      return createdAt.getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000;
    })
    .reduce((sum: number, subscription: (typeof active)[number]) => {
      return (
        sum +
        (subscription.billing_cycle === "yearly"
          ? subscription.current_price / 12
          : subscription.current_price)
      );
    }, 0);
  const mrrGrowthPct = mrr > 0 ? Math.round((recentMrr / Math.max(mrr, 1)) * 100) : 0;
  const churnRatePct = subscriptions.length > 0
    ? Math.round((cancelled.length / subscriptions.length) * 100)
    : 0;
  const retentionPct = Math.max(0, 100 - churnRatePct);

  return {
    subscriptions,
    metrics: {
      mrr,
      arr,
      active: active.length,
      trial: trial.length,
      cancelled: cancelled.length,
      failed,
      overdue,
      trialConv,
      mrr_growth_pct: mrrGrowthPct,
      active_subscriptions: active.length,
      trial_subscriptions: trial.length,
      churn_rate_pct: churnRatePct,
      retention_pct: retentionPct,
      projected_arr: arr,
    },
  };
}

async function buildWorkspaceBillingIntelligence(workspaceId: string) {
  const now = new Date();
  const thirtyDaysAgo = addDays(now, -30);
  const sixtyDaysAgo = addDays(now, -60);

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      createdAt: true,
      memberships: {
        where: {
          status: "active",
          role: "technician",
        },
        select: {
          id: true,
          createdAt: true,
        },
      },
      subscription: {
        select: {
          status: true,
          planCode: true,
        },
      },
      subscriptionEvents: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
      invoices: {
        where: {
          createdAt: { gte: sixtyDaysAgo },
        },
        select: {
          id: true,
          createdAt: true,
          status: true,
        },
      },
      manualTransfers: {
        where: {
          createdAt: { gte: sixtyDaysAgo },
        },
        select: {
          id: true,
          createdAt: true,
          status: true,
        },
      },
    },
  });

  if (!workspace) {
    return null;
  }

  const technicianCount = workspace.memberships.length;
  const recentAdditions = workspace.memberships.filter((membership: (typeof workspace.memberships)[number]) => {
    return membership.createdAt.getTime() >= thirtyDaysAgo.getTime();
  }).length;
  const previousTechnicianCount = Math.max(technicianCount - recentAdditions, 0);
  const technicianGrowthPct =
    previousTechnicianCount > 0
      ? Math.round(((technicianCount - previousTechnicianCount) / previousTechnicianCount) * 100)
      : recentAdditions > 0
        ? 100
        : 0;

  const latestTouches = [
    workspace.createdAt,
    workspace.subscriptionEvents[0]?.createdAt ?? null,
    ...workspace.invoices.map((invoice: (typeof workspace.invoices)[number]) => invoice.createdAt),
    ...workspace.manualTransfers.map((transfer: (typeof workspace.manualTransfers)[number]) => transfer.createdAt),
  ].filter((value): value is Date => value instanceof Date);
  const latestActivity = latestTouches.sort((a, b) => b.getTime() - a.getTime())[0] ?? workspace.createdAt;
  const daysSinceActivity = Math.max(0, Math.floor((now.getTime() - latestActivity.getTime()) / (24 * 60 * 60 * 1000)));

  const failedPayments60d = workspace.manualTransfers.filter((transfer: (typeof workspace.manualTransfers)[number]) => transfer.status === "rejected").length;
  const overdueInvoices60d = workspace.invoices.filter((invoice: (typeof workspace.invoices)[number]) => invoice.status === "overdue").length;
  const tier = findWorkspaceTier(workspace.subscription?.planCode, technicianCount);
  const tierCapacity = tier.tier_max ?? Math.max(technicianCount, tier.tier_min ?? technicianCount, 1);
  const utilization = tierCapacity > 0 ? technicianCount / tierCapacity : 0;

  let churnRisk: "low" | "medium" | "high" = "low";
  if (
    workspace.subscription?.status === "overdue" ||
    workspace.subscription?.status === "suspended" ||
    failedPayments60d >= 2 ||
    daysSinceActivity >= 21
  ) {
    churnRisk = "high";
  } else if (
    workspace.subscription?.status === "grace_period" ||
    failedPayments60d >= 1 ||
    overdueInvoices60d >= 1 ||
    daysSinceActivity >= 10
  ) {
    churnRisk = "medium";
  }

  let downgradeProbability: "low" | "medium" | "high" = "low";
  if (utilization < 0.35 && technicianCount > 0) {
    downgradeProbability = "high";
  } else if (utilization < 0.6) {
    downgradeProbability = "medium";
  }

  let growthAnomaly: "normal" | "spike" | "drop" = "normal";
  if (technicianGrowthPct >= 25) {
    growthAnomaly = "spike";
  } else if (technicianGrowthPct <= -10) {
    growthAnomaly = "drop";
  }

  const inactive = daysSinceActivity >= 14;
  const status =
    churnRisk === "high"
      ? "attention"
      : churnRisk === "medium"
        ? "watch"
        : "healthy";

  return {
    status,
    computed_at: now.toISOString(),
    churn_risk: churnRisk,
    downgrade_probability: downgradeProbability,
    growth_anomaly: growthAnomaly,
    technician_count: technicianCount,
    technician_growth_pct: technicianGrowthPct,
    failed_payments_60d: failedPayments60d,
    overdue_invoices_60d: overdueInvoices60d,
    days_since_activity: daysSinceActivity,
    inactive,
  };
}

async function requireWorkspaceAccess(req: AuthenticatedRequest, workspaceId: string) {
  const appUser = await prisma.appUser.findUnique({
    where: { authUserId: req.auth!.userId },
    select: { id: true },
  });

  if (!appUser) {
    return { appUser: null, workspace: null, allowed: false };
  }

  const membership = await prisma.membership.findFirst({
    where: {
      workspaceId,
      userId: appUser.id,
      status: "active",
    },
    select: { id: true },
  });

  const allowed = !!membership || req.auth!.role === "admin";

  if (!allowed) {
    return { appUser, workspace: null, allowed: false };
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      name: true,
      billingProfile: true,
      subscription: true,
    },
  });

  return { appUser, workspace, allowed: !!workspace };
}

async function logSubscriptionEvent(tx: Prisma.TransactionClient, workspaceId: string, args: {
  eventType: string;
  severity?: string;
  message?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  await tx.subscriptionEvent.create({
    data: {
      workspaceId,
      eventType: args.eventType,
      severity: args.severity ?? "info",
      message: args.message ?? null,
      metadata: args.metadata,
    },
  });
}

function mapInvoice(invoice: {
  id: string;
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date | null;
  total: number;
  subtotal: number | null;
  vatAmount: number | null;
  status: string;
  paidAt: Date | null;
  metadata: Prisma.JsonValue | null;
  pdfPath: string | null;
  pdfUrl: string | null;
  vatMode: string | null;
  bankSnapshot: Prisma.JsonValue | null;
}) {
  const total = Number(invoice.total ?? 0);
  const paid = invoice.paidAt ? total : 0;

  return {
    id: invoice.id,
    invoice_number: invoice.invoiceNumber,
    issue_date: invoice.issueDate.toISOString(),
    due_date: invoice.dueDate?.toISOString() ?? null,
    total_amount: total,
    paid_amount: paid,
    remaining_amount: Math.max(0, total - paid),
    status: invoice.status,
    stripe_invoice_id:
      typeof invoice.metadata === "object" &&
      invoice.metadata &&
      "stripe_invoice_id" in invoice.metadata
        ? invoice.metadata.stripe_invoice_id
        : null,
    metadata: invoice.metadata,
    pdf_path: invoice.pdfPath,
    pdf_url: invoice.pdfUrl,
    vat_mode: invoice.vatMode,
    vat_amount: invoice.vatAmount != null ? Number(invoice.vatAmount) : null,
    subtotal: invoice.subtotal != null ? Number(invoice.subtotal) : null,
    bank_snapshot: invoice.bankSnapshot,
  };
}

function mapManualTransfer(transfer: {
  id: string;
  workspaceId: string;
  invoiceId: string | null;
  referenceCode: string;
  amount: number;
  currency: string;
  bankAccountId: string | null;
  paymentMethod: string | null;
  transferDate: Date | null;
  proofPath: string | null;
  proofName: string | null;
  notes: string | null;
  reviewerNotes: string | null;
  reviewedAt: Date | null;
  status: string;
  createdAt: Date;
}) {
  return {
    id: transfer.id,
    workspace_id: transfer.workspaceId,
    invoice_id: transfer.invoiceId,
    reference_code: transfer.referenceCode,
    amount: transfer.amount,
    currency: transfer.currency,
    bank_account_id: transfer.bankAccountId,
    status: transfer.status,
    payment_method: transfer.paymentMethod,
    transfer_date: transfer.transferDate?.toISOString() ?? null,
    proof_path: transfer.proofPath,
    proof_name: transfer.proofName,
    notes: transfer.notes,
    reviewer_notes: transfer.reviewerNotes,
    declared_at: transfer.createdAt.toISOString(),
    reviewed_at: transfer.reviewedAt?.toISOString() ?? null,
  };
}

billingRouter.get("/workspace-tiers", async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({
      tiers: WORKSPACE_TIERS,
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/platform-bank-accounts", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    await ensureDefaultBankAccounts();
    const query =
      (req as AuthenticatedRequest & { query: { vatMode?: string | string[] } }).query;
    const vatMode = typeof query.vatMode === "string" ? query.vatMode : null;
    const accounts = await prisma.platformBankAccount.findMany({
      where: { active: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });

    const filtered =
      vatMode === "personal"
        ? accounts.filter((account: { accountType: string }) => account.accountType === "personal")
        : vatMode === "business"
          ? accounts.filter((account: { accountType: string }) => account.accountType !== "personal")
          : accounts;

    return res.json({
      accounts: (filtered.length > 0 ? filtered : accounts).map((account: {
        id: string;
        bankName: string;
        accountName: string;
        iban: string | null;
        bic: string | null;
        country: string;
        currency: string;
        accountType: string;
        isPrimary: boolean;
        active: boolean;
      }) => ({
        id: account.id,
        bank_name: account.bankName,
        account_name: account.accountName,
        iban: account.iban,
        bic: account.bic,
        country: account.country,
        currency: account.currency,
        account_type: account.accountType,
        is_primary: account.isPrimary,
        active: account.active,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/vat/calculate", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const input = vatCalcSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    return res.json(computeVat({
      country: input.country,
      isBusiness: input.is_business,
      vatNumber: input.vat_number,
    }));
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/workspaces/:workspaceId/profile", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = workspaceIdSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const access = await requireWorkspaceAccess(req, workspaceId);

    if (!access.allowed || !access.workspace) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const profile = access.workspace.billingProfile;
    return res.json({
      profile: profile
        ? {
            id: profile.id,
            workspace_id: profile.workspaceId,
            legal_name: profile.legalName,
            company_name: profile.companyName,
            billing_email: profile.billingEmail,
            billing_address: profile.billingAddress,
            city: profile.city,
            postal_code: profile.postalCode,
            country: profile.country,
            vat_number: profile.vatNumber,
            is_business: profile.isBusiness,
            preferred_currency: profile.preferredCurrency,
            vat_mode: profile.vatMode === "manual" ? "with_vat" : profile.vatMode,
          }
        : null,
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.patch("/workspaces/:workspaceId/profile", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = workspaceIdSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const input = billingProfileSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const access = await requireWorkspaceAccess(req, workspaceId);

    if (!access.allowed || !access.workspace) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const profile = await prisma.billingProfile.upsert({
      where: { workspaceId },
      update: {
        legalName: input.legal_name.trim(),
        companyName: input.company_name?.trim() || null,
        billingEmail: input.billing_email.trim().toLowerCase(),
        billingAddress: input.billing_address?.trim() || null,
        city: input.city?.trim() || null,
        postalCode: input.postal_code?.trim() || null,
        country: input.country.toUpperCase(),
        vatNumber: input.vat_number?.trim() || null,
        isBusiness: input.is_business,
        preferredCurrency: input.preferred_currency.toUpperCase(),
        vatMode: input.vat_mode,
      },
      create: {
        workspaceId,
        legalName: input.legal_name.trim(),
        companyName: input.company_name?.trim() || null,
        billingEmail: input.billing_email.trim().toLowerCase(),
        billingAddress: input.billing_address?.trim() || null,
        city: input.city?.trim() || null,
        postalCode: input.postal_code?.trim() || null,
        country: input.country.toUpperCase(),
        vatNumber: input.vat_number?.trim() || null,
        isBusiness: input.is_business,
        preferredCurrency: input.preferred_currency.toUpperCase(),
        vatMode: input.vat_mode,
      },
    });

    return res.json({
      profile: {
        id: profile.id,
        workspace_id: profile.workspaceId,
        legal_name: profile.legalName,
        company_name: profile.companyName,
        billing_email: profile.billingEmail,
        billing_address: profile.billingAddress,
        city: profile.city,
        postal_code: profile.postalCode,
        country: profile.country,
        vat_number: profile.vatNumber,
        is_business: profile.isBusiness,
        preferred_currency: profile.preferredCurrency,
        vat_mode: profile.vatMode,
      },
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/workspaces/:workspaceId/payment-methods", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = workspaceIdSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const access = await requireWorkspaceAccess(req, workspaceId);

    if (!access.allowed || !access.workspace) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const methods = await prisma.paymentMethod.findMany({
      where: { workspaceId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });

    return res.json({
      methods: methods.map((method: {
        id: string;
        workspaceId: string;
        kind: string;
        brand: string | null;
        last4: string | null;
        holderName: string | null;
        ibanMasked: string | null;
        isDefault: boolean;
        provider: string;
      }) => ({
        id: method.id,
        workspace_id: method.workspaceId,
        kind: method.kind,
        brand: method.brand,
        last4: method.last4,
        holder_name: method.holderName,
        iban_masked: method.ibanMasked,
        is_default: method.isDefault,
        provider: method.provider,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/workspaces/:workspaceId/payment-methods", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = workspaceIdSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const input = paymentMethodSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const access = await requireWorkspaceAccess(req, workspaceId);

    if (!access.allowed || !access.workspace) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const method = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (input.is_default) {
        await tx.paymentMethod.updateMany({
          where: { workspaceId },
          data: { isDefault: false },
        });
      }

      const created = await tx.paymentMethod.create({
        data: {
          workspaceId,
          kind: input.kind,
          brand: input.brand?.trim() || null,
          last4: input.last4?.trim() || null,
          holderName: input.holder_name?.trim() || null,
          ibanMasked: input.iban_masked?.trim() || null,
          isDefault: input.is_default,
          provider: "mock",
        },
      });

      await logSubscriptionEvent(tx, workspaceId, {
        eventType: "payment_method_added",
        severity: "info",
        message: `Metodo de pagamento ${input.kind} registado.`,
      });

      return created;
    });

    return res.status(201).json({
      method: {
        id: method.id,
        workspace_id: method.workspaceId,
        kind: method.kind,
        brand: method.brand,
        last4: method.last4,
        holder_name: method.holderName,
        iban_masked: method.ibanMasked,
        is_default: method.isDefault,
        provider: method.provider,
      },
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/workspaces/:workspaceId/subscription-events", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = workspaceIdSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });
    const { limit } = querySchema.parse((req as AuthenticatedRequest & { query: unknown }).query);
    const access = await requireWorkspaceAccess(req, workspaceId);

    if (!access.allowed || !access.workspace) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const events = await prisma.subscriptionEvent.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return res.json({
      events: events.map((event: {
        id: string;
        workspaceId: string;
        eventType: string;
        severity: string;
        message: string | null;
        metadata: Prisma.JsonValue | null;
        createdAt: Date;
      }) => ({
        id: event.id,
        workspace_id: event.workspaceId,
        event_type: event.eventType,
        severity: event.severity,
        message: event.message,
        metadata: event.metadata,
        created_at: event.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/workspaces/:workspaceId/intelligence", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = workspaceIdSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const access = await requireWorkspaceAccess(req, workspaceId);

    if (!access.allowed || !access.workspace) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const intelligence = await buildWorkspaceBillingIntelligence(workspaceId);
    return res.json({
      intelligence,
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/workspaces/:workspaceId/checkout-session", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = workspaceIdSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const input = checkoutSessionSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const access = await requireWorkspaceAccess(req, workspaceId);

    if (!access.allowed || !access.workspace) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const environment =
      getConfiguredStripeEnvironment(input.environment ?? access.workspace.subscription?.stripeEnvironment ?? null);

    if (!environment) {
      return res.status(503).json({
        message: "Stripe não está configurado nesta VPS.",
      });
    }

    const stripe = createStripeClient(environment);
    const prices = await stripe.prices.list({
      lookup_keys: [input.lookup_key],
      active: true,
      limit: 1,
      expand: ["data.product"],
    });

    if (prices.data.length === 0) {
      return res.status(404).json({
        message: `Price not found for lookup_key: ${input.lookup_key}`,
      });
    }

    const price = prices.data[0];
    const customerId = await resolveOrCreateStripeCustomer({
      environment,
      workspaceId,
      customerEmail: input.customer_email ?? null,
      legalName: input.legal_name ?? null,
      authUserId: req.auth?.userId ?? null,
    });
    const pendingInvoice = await prisma.platformInvoice.findFirst({
      where: {
        workspaceId,
        status: {
          in: ["pending", "draft"],
        },
      },
      orderBy: [{ createdAt: "desc" }],
      select: { id: true },
    });

    await prisma.workspaceSubscription.upsert({
      where: { workspaceId },
      update: {
        stripeCustomerId: customerId,
        stripeEnvironment: environment,
        stripePriceLookupKey: input.lookup_key,
        lastRecalculatedAt: new Date(),
      },
      create: {
        workspaceId,
        planCode: input.lookup_key.replace(/_(monthly|yearly)$/, ""),
        status: "trial",
        billingCycle: input.lookup_key.endsWith("_yearly") ? "yearly" : "monthly",
        trialStartedAt: new Date(),
        trialEndsAt: addDays(new Date(), 14),
        stripeCustomerId: customerId,
        stripeEnvironment: environment,
        stripePriceLookupKey: input.lookup_key,
        lastRecalculatedAt: new Date(),
      },
    });

    const metadata = {
      workspaceId,
      lookup_key: input.lookup_key,
      ...(req.auth?.userId ? { userId: req.auth.userId } : {}),
      ...(pendingInvoice?.id ? { platform_invoice_id: pendingInvoice.id } : {}),
    };

    const session = await stripe.checkout.sessions.create({
      mode: price.type === "recurring" ? "subscription" : "payment",
      ui_mode: "embedded",
      customer: customerId,
      return_url: input.return_url,
      line_items: [{ price: price.id, quantity: 1 }],
      metadata,
      ...(price.type === "recurring"
        ? {
            subscription_data: {
              metadata,
            },
          }
        : {
            payment_intent_data: {
              metadata,
              description:
                typeof price.product === "object" && price.product && "name" in price.product
                  ? String(price.product.name)
                  : input.lookup_key,
            },
          }),
    });

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await logSubscriptionEvent(tx, workspaceId, {
        eventType: "stripe.checkout.started",
        severity: "info",
        message: `Stripe checkout iniciado para ${input.lookup_key}.`,
        metadata: {
          customer_id: customerId,
          environment,
          session_id: session.id,
          lookup_key: input.lookup_key,
        },
      });
    });

    if (!session.client_secret) {
      return res.status(502).json({
        message: "Stripe não devolveu client secret para o checkout embutido.",
      });
    }

    return res.json({
      clientSecret: session.client_secret,
      sessionId: session.id,
      environment,
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/workspaces/:workspaceId/portal-session", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = workspaceIdSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const bodySchema = z.object({
      return_url: z.string().url().optional().nullable(),
    });
    const input = bodySchema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const access = await requireWorkspaceAccess(req, workspaceId);

    if (!access.allowed || !access.workspace) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const subscription = await prisma.workspaceSubscription.findUnique({
      where: { workspaceId },
      select: {
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        stripeEnvironment: true,
      },
    });

    if (!subscription?.stripeCustomerId) {
      return res.json({
        requires_checkout: true,
        message: "Sem subscrição Stripe ativa para gerir.",
        url: null,
      });
    }

    const environment = getConfiguredStripeEnvironment(subscription.stripeEnvironment);
    if (environment) {
      const stripe = createStripeClient(environment);
      const session = await stripe.billingPortal.sessions.create({
        customer: subscription.stripeCustomerId,
        ...(input.return_url ? { return_url: input.return_url } : {}),
      });

      return res.json({
        requires_checkout: false,
        message: null,
        url: session.url,
      });
    }

    const baseUrl =
      subscription.stripeEnvironment === "live"
        ? env.STRIPE_PORTAL_LIVE_URL || ""
        : env.STRIPE_PORTAL_SANDBOX_URL || "";

    if (!baseUrl) {
      return res.json({
        requires_checkout: false,
        message: "Portal Stripe ainda não configurado nesta VPS.",
        url: null,
      });
    }

    const portalUrl = new URL(baseUrl);
    portalUrl.searchParams.set("workspace_id", workspaceId);
    portalUrl.searchParams.set("customer_id", subscription.stripeCustomerId);
    if (subscription.stripeSubscriptionId) {
      portalUrl.searchParams.set("subscription_id", subscription.stripeSubscriptionId);
    }
    if (input.return_url) {
      portalUrl.searchParams.set("return_url", input.return_url);
    }

    return res.json({
      requires_checkout: false,
      message: null,
      url: portalUrl.toString(),
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/workspaces/:workspaceId/invoices", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = workspaceIdSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const access = await requireWorkspaceAccess(req, workspaceId);

    if (!access.allowed || !access.workspace) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const invoices = await prisma.platformInvoice.findMany({
      where: { workspaceId },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    });

    return res.json({
      invoices: invoices.map(mapInvoice),
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/workspaces/:workspaceId/manual-transfers", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = workspaceIdSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const querySchema = z.object({
      invoiceId: z.string().uuid().optional(),
    });
    const { invoiceId } = querySchema.parse((req as AuthenticatedRequest & { query: unknown }).query);
    const access = await requireWorkspaceAccess(req, workspaceId);

    if (!access.allowed || !access.workspace) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const transfers = await prisma.manualBankTransfer.findMany({
      where: {
        workspaceId,
        ...(invoiceId ? { invoiceId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({
      transfers: transfers.map(mapManualTransfer),
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/workspaces/:workspaceId/manual-transfers", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = workspaceIdSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const input = manualTransferSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const access = await requireWorkspaceAccess(req, workspaceId);

    if (!access.allowed || !access.workspace) {
      return res.status(403).json({ message: "Forbidden." });
    }

    if (input.invoice_id) {
      const invoice = await prisma.platformInvoice.findFirst({
        where: {
          id: input.invoice_id,
          workspaceId,
        },
        select: { id: true },
      });

      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found." });
      }
    }

    const referenceCode = `MBT-${Date.now().toString(36).toUpperCase()}`;

    const transfer = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.manualBankTransfer.create({
        data: {
          workspaceId,
          referenceCode,
          amount: input.amount,
          currency: input.currency.toUpperCase(),
          invoiceId: input.invoice_id ?? null,
          bankAccountId: input.bank_account_id ?? null,
          paymentMethod: input.payment_method,
          transferDate: input.transfer_date ? new Date(input.transfer_date) : null,
          proofPath: input.proof_path ?? null,
          proofName: input.proof_name ?? null,
          notes: input.notes ?? null,
          status: input.proof_path ? "pending_manual_review" : "awaiting_transfer",
        },
      });

      await logSubscriptionEvent(tx, workspaceId, {
        eventType: "manual_transfer_declared",
        severity: "info",
        message: "Transferencia bancaria declarada (aguardando revisao).",
        metadata: {
          reference_code: referenceCode,
          amount: input.amount,
          currency: input.currency.toUpperCase(),
          invoice_id: input.invoice_id ?? null,
        },
      });

      return created;
    });

    return res.status(201).json({
      transfer: mapManualTransfer(transfer),
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/workspaces/:workspaceId/invoices/preview", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = workspaceIdSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const input = previewInvoiceSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const access = await requireWorkspaceAccess(req, workspaceId);

    if (!access.allowed || !access.workspace) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const issuedAt = startOfDay(new Date());
    const dueDate = addDays(issuedAt, 14);
    const vatAmount = input.vat_mode === "business" ? Math.round(input.amount * input.vat_rate * 100) / 100 : 0;
    const total = Math.round((input.amount + vatAmount) * 100) / 100;
    const invoiceNumber = `INV-${issuedAt.getFullYear()}-${Math.floor(Math.random() * 90000 + 10000)}`;
    const selectedBank = input.bank_account_id
      ? await prisma.platformBankAccount.findUnique({ where: { id: input.bank_account_id } })
      : null;
    const bankSnapshot = selectedBank
      ? {
          bank_name: selectedBank.bankName,
          account_name: selectedBank.accountName,
          iban: selectedBank.iban,
          bic: selectedBank.bic,
          reference: invoiceNumber,
        }
      : null;

    if (input.invoice_id) {
      const existingInvoice = await prisma.platformInvoice.findFirst({
        where: {
          id: input.invoice_id,
          workspaceId,
        },
        select: { id: true },
      });

      if (!existingInvoice) {
        return res.status(404).json({ message: "Invoice not found." });
      }
    }

    const invoice = input.invoice_id
      ? await prisma.platformInvoice.update({
          where: { id: input.invoice_id },
          data: {
            invoiceNumber,
            issueDate: issuedAt,
            dueDate,
            subtotal: input.amount,
            vatAmount,
            total,
            status: "pending",
            vatMode: input.vat_mode === "business" ? "with_vat" : "no_vat",
            bankSnapshot: bankSnapshot ? (bankSnapshot as Prisma.InputJsonValue) : Prisma.JsonNull,
            metadata: {
              currency: "EUR",
              plan_code: input.plan_code,
              cycle: input.cycle,
              legal_name: input.legal_name,
              billing_email: input.billing_email,
              country: input.country,
              vat_number: input.vat_number ?? null,
              items: [
                {
                  description: `Subscricao ${input.plan_code} (${input.cycle})`,
                  quantity: 1,
                  unit_price: input.amount,
                  total: input.amount,
                },
              ],
            },
          },
        })
      : await prisma.platformInvoice.create({
          data: {
            workspaceId,
            invoiceNumber,
            issueDate: issuedAt,
            dueDate,
            subtotal: input.amount,
            vatAmount,
            total,
            status: "pending",
            vatMode: input.vat_mode === "business" ? "with_vat" : "no_vat",
            bankSnapshot: bankSnapshot ? (bankSnapshot as Prisma.InputJsonValue) : Prisma.JsonNull,
            metadata: {
              currency: "EUR",
              plan_code: input.plan_code,
              cycle: input.cycle,
              legal_name: input.legal_name,
              billing_email: input.billing_email,
              country: input.country,
              vat_number: input.vat_number ?? null,
              items: [
                {
                  description: `Subscricao ${input.plan_code} (${input.cycle})`,
                  quantity: 1,
                  unit_price: input.amount,
                  total: input.amount,
                },
              ],
            },
          },
        });

    return res.json({
      invoice: {
        id: invoice.id,
        invoice_id: invoice.id,
        invoice_number: invoiceNumber,
        issued_at: issuedAt.toISOString(),
        due_date: dueDate.toISOString(),
        subtotal: input.amount,
        vat_amount: vatAmount,
        total,
        currency: "EUR",
        vat_exemption: input.vat_exemption ?? null,
        items: [
          {
            description: `Subscricao ${input.plan_code} (${input.cycle})`,
            quantity: 1,
            unit_price: input.amount,
            total: input.amount,
          },
        ],
      },
      bank_instructions: bankSnapshot,
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/invoices/:invoiceId/pdf", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const paramsSchema = z.object({ invoiceId: z.string().uuid() });
    const { invoiceId } = paramsSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const invoice = await prisma.platformInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        workspace: {
          include: {
            billingProfile: true,
          },
        },
      },
    });

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found." });
    }

    const access = await requireWorkspaceAccess(req, invoice.workspaceId);
    if (!access.allowed && req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const currency =
      typeof invoice.metadata === "object" &&
      invoice.metadata &&
      "currency" in invoice.metadata &&
      typeof invoice.metadata.currency === "string"
        ? invoice.metadata.currency
        : "EUR";

    const pdf = buildSimplePdf({
      title: `Fatura ${invoice.invoiceNumber}`,
      lines: [
        `Workspace: ${invoice.workspace.name}`,
        `Emitida: ${invoice.issueDate.toISOString().slice(0, 10)}`,
        invoice.dueDate ? `Vencimento: ${invoice.dueDate.toISOString().slice(0, 10)}` : "Vencimento: —",
        `Total: ${invoice.total.toFixed(2)} ${currency}`,
      ],
    });
    const signedUrl = `data:application/pdf;base64,${pdf.toString("base64")}`;

    return res.json({
      signedUrl,
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/reports/financial/pdf", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      periodMonths: z.number().int().min(1).max(36).default(6),
      generatedAt: z.string().optional(),
      kpis: z.object({
        totalRevenue: z.number(),
        totalExpenses: z.number(),
        totalReceived: z.number().optional(),
        received: z.number().optional(),
        overdueAmount: z.number(),
        pendingAmount: z.number(),
        profit: z.number(),
        inadimplenciaPct: z.number(),
      }),
      monthly: z.array(z.object({
        label: z.string(),
        revenue: z.number(),
        expenses: z.number(),
        received: z.number(),
        profit: z.number(),
        overdue: z.number(),
      })).max(36),
    });

    const input = schema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const now = input.generatedAt ? new Date(input.generatedAt) : new Date();
    const receivedAmount = input.kpis.totalReceived ?? input.kpis.received ?? 0;

    const money = (v: number) => (Number.isFinite(v) ? v : 0).toFixed(2) + " EUR";
    const lines: string[] = [];
    lines.push(`Gerado: ${now.toISOString().slice(0, 19).replace("T", " ")}`);
    lines.push(`Período: últimos ${input.periodMonths} meses`);
    lines.push("");
    lines.push(`Faturamento: ${money(input.kpis.totalRevenue)}`);
    lines.push(`Despesas: ${money(input.kpis.totalExpenses)}`);
    lines.push(`Recebido: ${money(receivedAmount)}`);
    lines.push(`Lucro: ${money(input.kpis.profit)}`);
    lines.push(`Inadimplência: ${input.kpis.inadimplenciaPct.toFixed(1)}%`);
    lines.push(`Em atraso: ${money(input.kpis.overdueAmount)}`);
    lines.push(`Pendente: ${money(input.kpis.pendingAmount)}`);
    lines.push("");
    lines.push("Resumo mensal:");
    for (const m of input.monthly.slice(0, input.periodMonths)) {
      lines.push(`${m.label} · Rev ${money(m.revenue)} · Exp ${money(m.expenses)} · Rec ${money(m.received)} · Luc ${money(m.profit)} · Atr ${money(m.overdue)}`);
    }

    const pdf = buildSimplePdf({
      title: "Relatório Financeiro",
      lines,
    });
    const signedUrl = `data:application/pdf;base64,${pdf.toString("base64")}`;

    return res.json({ signedUrl });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/reports/financial/email", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!isEmailConfigured()) {
      return res.status(503).json({ message: "Email provider not configured." });
    }

    const schema = z.object({
      periodMonths: z.number().int().min(1).max(36).default(6),
      generatedAt: z.string().optional(),
      kpis: z.object({
        totalRevenue: z.number(),
        totalExpenses: z.number(),
        totalReceived: z.number().optional(),
        received: z.number().optional(),
        overdueAmount: z.number(),
        pendingAmount: z.number(),
        profit: z.number(),
        inadimplenciaPct: z.number(),
      }),
      monthly: z.array(z.object({
        label: z.string(),
        revenue: z.number(),
        expenses: z.number(),
        received: z.number(),
        profit: z.number(),
        overdue: z.number(),
      })).max(36),
    });
    const input = schema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const receivedAmount = input.kpis.totalReceived ?? input.kpis.received ?? 0;

    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true, email: true, fullName: true, appUser: { select: { workspaceId: true } } },
    });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const money = (v: number) => (Number.isFinite(v) ? v : 0).toFixed(2) + " EUR";
    const lines: string[] = [
      `Gerado: ${(input.generatedAt ? new Date(input.generatedAt) : new Date()).toISOString().slice(0, 19).replace("T", " ")}`,
      `Período: últimos ${input.periodMonths} meses`,
      "",
      `Faturamento: ${money(input.kpis.totalRevenue)}`,
      `Despesas: ${money(input.kpis.totalExpenses)}`,
      `Recebido: ${money(receivedAmount)}`,
      `Lucro: ${money(input.kpis.profit)}`,
      `Inadimplência: ${input.kpis.inadimplenciaPct.toFixed(1)}%`,
      `Em atraso: ${money(input.kpis.overdueAmount)}`,
      `Pendente: ${money(input.kpis.pendingAmount)}`,
      "",
      "Resumo mensal:",
      ...input.monthly.slice(0, input.periodMonths).map((m: (typeof input.monthly)[number]) =>
        `${m.label} · Rev ${money(m.revenue)} · Exp ${money(m.expenses)} · Rec ${money(m.received)} · Luc ${money(m.profit)} · Atr ${money(m.overdue)}`),
    ];
    const pdf = buildSimplePdf({
      title: "Relatório Financeiro",
      lines,
    });
    const tpl = reportEmail({
      title: "Relatório Financeiro Operix",
      body: `Segue o relatório financeiro dos últimos ${input.periodMonths} meses.`,
    });
    const sendResult = await sendEmail({
      to: user.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      attachments: [{
        filename: `relatorio-financeiro-${new Date().toISOString().slice(0, 10)}.pdf`,
        contentBase64: pdf.toString("base64"),
      }],
    });
    if (!sendResult.ok) {
      return res.status(502).json({ message: sendResult.error });
    }

    await prisma.backendEventLog.create({
      data: {
        tableName: "reports",
        rowId: null,
        action: "report.financial.email.sent",
        actorUserId: user.id,
        workspaceId: user.appUser?.workspaceId ?? null,
        payload: {
          provider: sendResult.provider,
          email_id: sendResult.id,
          period_months: input.periodMonths,
        } as Prisma.InputJsonValue,
      },
    });

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/admin/financial-overview", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const { metrics } = await buildPlatformFinancialOverview();
    return res.json(metrics);
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/admin/smart-metrics", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const { metrics } = await buildPlatformFinancialOverview();
    return res.json(metrics);
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/admin/automation/last-run", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const event = await prisma.subscriptionEvent.findFirst({
      where: {
        eventType: "automation.run",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json({
      lastRun: event
        ? {
            created_at: event.createdAt.toISOString(),
            metadata: event.metadata,
          }
        : null,
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/admin/automation/run", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const now = new Date();
    const subscriptions = await prisma.workspaceSubscription.findMany({
      select: {
        workspaceId: true,
        status: true,
        currentPeriodEnd: true,
      },
    });
    const invoices = await prisma.platformInvoice.findMany({
      select: {
        workspaceId: true,
        status: true,
        dueDate: true,
      },
    });

    const renewalsProcessed = subscriptions.filter((subscription: (typeof subscriptions)[number]) => {
      return (
        subscription.status === "active" &&
        !!subscription.currentPeriodEnd &&
        subscription.currentPeriodEnd.getTime() <= now.getTime()
      );
    }).length;
    const retriesProcessed = invoices.filter((invoice: (typeof invoices)[number]) => {
      return (
        invoice.status === "overdue" ||
        (!!invoice.dueDate && invoice.dueDate.getTime() <= now.getTime() && invoice.status !== "paid")
      );
    }).length;
    const transitionsCount = subscriptions.filter((subscription: (typeof subscriptions)[number]) => {
      return subscription.status === "grace_period" || subscription.status === "overdue";
    }).length;

    const auditWorkspace = await prisma.workspace.findFirst({
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });

    if (auditWorkspace) {
      await prisma.subscriptionEvent.create({
        data: {
          workspaceId: auditWorkspace.id,
          eventType: "automation.run",
          severity: "info",
          message: "Execucao manual do motor de automacao de billing.",
          metadata: {
            renewals_processed: renewalsProcessed,
            retries_processed: retriesProcessed,
            transitions_processed: transitionsCount,
          } as Prisma.InputJsonValue,
        },
      });
    }

    return res.json({
      renewals: { processed: renewalsProcessed },
      retries: { processed: retriesProcessed },
      transitions: { transitions: transitionsCount },
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/admin/overview", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const { subscriptions } = await buildPlatformFinancialOverview();
    return res.json({ subscriptions });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/admin/bank-accounts", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    await ensureDefaultBankAccounts();
    const accounts = await prisma.platformBankAccount.findMany({
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });

    return res.json({
      accounts: accounts.map(mapPlatformBankAccount),
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.patch("/admin/bank-accounts/:accountId", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const paramsSchema = z.object({ accountId: z.string().uuid() });
    const { accountId } = paramsSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const patch = adminBankAccountPatchSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);

    const account = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (patch.is_primary) {
        await tx.platformBankAccount.updateMany({
          data: { isPrimary: false },
        });
      }

      return tx.platformBankAccount.update({
        where: { id: accountId },
        data: {
          active: patch.active,
          iban: patch.iban === undefined ? undefined : patch.iban?.trim() || null,
          bic: patch.bic === undefined ? undefined : patch.bic?.trim() || null,
          accountName: patch.account_name?.trim(),
          bankName: patch.bank_name?.trim(),
          isPrimary: patch.is_primary,
        },
      });
    });

    return res.json({
      account: mapPlatformBankAccount(account),
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/admin/subscriptions", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const subscriptions = await listAdminSubscriptions();
    return res.json({ subscriptions });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/admin/payments", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const transfers = await prisma.manualBankTransfer.findMany({
      include: {
        workspace: {
          include: {
            billingProfile: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const invoiceIds = transfers
      .map((transfer: (typeof transfers)[number]) => transfer.invoiceId)
      .filter((invoiceId: string | null): invoiceId is string => !!invoiceId);
    const invoices = invoiceIds.length
      ? await prisma.platformInvoice.findMany({
          where: { id: { in: invoiceIds } },
          select: { id: true, invoiceNumber: true, total: true, subtotal: true, vatAmount: true, status: true, metadata: true },
        })
      : [];
    const invoicesById = new Map<string, (typeof invoices)[number]>(
      invoices.map((invoice: (typeof invoices)[number]) => [invoice.id, invoice]),
    );

    return res.json({
      methods: listAdminPaymentMethods(),
      payments: transfers.map((transfer: (typeof transfers)[number]) => ({
        id: transfer.id,
        workspace_id: transfer.workspaceId,
        workspace_name: transfer.workspace?.name ?? null,
        method: transfer.paymentMethod ?? "bank_transfer",
        payment_method_id: transfer.paymentMethod ?? "bank_transfer",
        amount: transfer.amount,
        currency: transfer.currency,
        status: mapTransferStatusToAdmin(transfer.status),
        external_ref: transfer.referenceCode,
        reference: transfer.referenceCode,
        invoice_id: transfer.invoiceId,
        invoice_number: transfer.invoiceId ? invoicesById.get(transfer.invoiceId)?.invoiceNumber ?? null : null,
        customer_name: transfer.workspace?.billingProfile?.legalName ?? transfer.workspace?.name ?? null,
        payment_date: (transfer.transferDate ?? transfer.reviewedAt ?? transfer.createdAt).toISOString().slice(0, 10),
        notes: sanitizePaymentNotes(transfer.notes),
        account: extractAccountFromNotes(transfer.notes),
        proof_path: transfer.proofPath,
        proof_name: transfer.proofName,
        attachments: transfer.proofPath
          ? [
              {
                id: `${transfer.id}-proof`,
                file_name: transfer.proofName ?? "comprovante",
                mime_type: transfer.proofPath.startsWith("data:") ? transfer.proofPath.slice(5, transfer.proofPath.indexOf(";")) : null,
                size_bytes: null,
                signed_url: transfer.proofPath,
              },
            ]
          : [],
        invoice:
          transfer.invoiceId && invoicesById.get(transfer.invoiceId)
            ? {
                id: transfer.invoiceId,
                invoice_number: invoicesById.get(transfer.invoiceId)!.invoiceNumber,
                total_amount: invoicesById.get(transfer.invoiceId)!.total,
                subtotal: invoicesById.get(transfer.invoiceId)!.subtotal,
                vat_amount: invoicesById.get(transfer.invoiceId)!.vatAmount,
                status: invoicesById.get(transfer.invoiceId)!.status,
                metadata: invoicesById.get(transfer.invoiceId)!.metadata,
              }
            : null,
        created_at: transfer.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/admin/payment-methods", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    return res.json({
      methods: listAdminPaymentMethods(),
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/admin/payments", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const input = adminPaymentUpsertSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const invoice = await prisma.platformInvoice.findUnique({
      where: { id: input.invoice_id },
      select: { id: true, workspaceId: true },
    });

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found." });
    }

    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const payment = await tx.manualBankTransfer.create({
        data: {
          workspaceId: invoice.workspaceId,
          invoiceId: invoice.id,
          referenceCode: input.reference?.trim() || `PMT-${Date.now().toString(36).toUpperCase()}`,
          amount: input.amount,
          currency: "EUR",
          paymentMethod: input.payment_method_id || "bank_transfer",
          transferDate: new Date(`${input.payment_date.slice(0, 10)}T12:00:00.000Z`),
          proofPath: input.proof_path ?? null,
          proofName: input.proof_name ?? null,
          notes: [input.notes?.trim() || null, input.account ? `Conta: ${input.account.trim()}` : null].filter(Boolean).join(" · ") || null,
          status: mapAdminStatusToTransfer(input.status),
          reviewedAt: input.status === "confirmed" || input.status === "failed" || input.status === "refunded" ? new Date() : null,
        },
      });

      await syncPlatformInvoicePaymentState(tx, invoice.id);
      await logSubscriptionEvent(tx, invoice.workspaceId, {
        eventType: "admin.payment.created",
        severity: input.status === "confirmed" ? "success" : input.status === "failed" ? "warning" : "info",
        message: `Pagamento administrativo registado (${input.status}).`,
        metadata: {
          invoice_id: invoice.id,
          amount: input.amount,
          method: input.payment_method_id || "bank_transfer",
          reference: payment.referenceCode,
        },
      });

      return payment;
    });

    return res.status(201).json({
      payment: {
        id: created.id,
      },
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.patch("/admin/payments/:paymentId", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const paramsSchema = z.object({ paymentId: z.string().uuid() });
    const { paymentId } = paramsSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const input = adminPaymentUpsertSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);

    const existing = await prisma.manualBankTransfer.findUnique({
      where: { id: paymentId },
      select: { id: true, workspaceId: true, invoiceId: true, referenceCode: true },
    });

    if (!existing) {
      return res.status(404).json({ message: "Payment not found." });
    }

    const invoice = await prisma.platformInvoice.findUnique({
      where: { id: input.invoice_id },
      select: { id: true, workspaceId: true },
    });

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found." });
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.manualBankTransfer.update({
        where: { id: paymentId },
        data: {
          workspaceId: invoice.workspaceId,
          invoiceId: invoice.id,
          referenceCode: input.reference?.trim() || existing.referenceCode,
          amount: input.amount,
          paymentMethod: input.payment_method_id || "bank_transfer",
          transferDate: new Date(`${input.payment_date.slice(0, 10)}T12:00:00.000Z`),
          proofPath: input.proof_path ?? null,
          proofName: input.proof_name ?? null,
          notes: [input.notes?.trim() || null, input.account ? `Conta: ${input.account.trim()}` : null].filter(Boolean).join(" · ") || null,
          status: mapAdminStatusToTransfer(input.status),
          reviewedAt: input.status === "confirmed" || input.status === "failed" || input.status === "refunded" ? new Date() : null,
        },
      });

      if (existing.invoiceId) {
        await syncPlatformInvoicePaymentState(tx, existing.invoiceId);
      }
      await syncPlatformInvoicePaymentState(tx, invoice.id);
      await logSubscriptionEvent(tx, invoice.workspaceId, {
        eventType: "admin.payment.updated",
        severity: "info",
        message: `Pagamento administrativo atualizado (${input.status}).`,
        metadata: {
          invoice_id: invoice.id,
          payment_id: paymentId,
          amount: input.amount,
          method: input.payment_method_id || "bank_transfer",
        },
      });
    });

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

billingRouter.delete("/admin/payments/:paymentId", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const paramsSchema = z.object({ paymentId: z.string().uuid() });
    const { paymentId } = paramsSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.manualBankTransfer.findUnique({
        where: { id: paymentId },
        select: { invoiceId: true, workspaceId: true, referenceCode: true },
      });

      if (!existing) {
        return;
      }

      await tx.manualBankTransfer.delete({
        where: { id: paymentId },
      });

      if (existing.invoiceId) {
        await syncPlatformInvoicePaymentState(tx, existing.invoiceId);
      }

      await logSubscriptionEvent(tx, existing.workspaceId, {
        eventType: "admin.payment.deleted",
        severity: "warning",
        message: `Pagamento administrativo ${existing.referenceCode} eliminado.`,
        metadata: {
          payment_id: paymentId,
          invoice_id: existing.invoiceId,
        },
      });
    });

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/admin/vat-rules", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    return res.json({
      rules: VAT_RULES,
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/admin/invoices", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const invoices = await prisma.platformInvoice.findMany({
      include: {
        workspace: {
          include: {
            billingProfile: true,
          },
        },
      },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    });

    const paymentSummary = await getInvoicePaymentSummary(invoices.map((invoice: (typeof invoices)[number]) => invoice.id));

    return res.json({
      invoices: invoices.map((invoice: (typeof invoices)[number]) => {
        const meta = asJsonRecord(invoice.metadata);
        const summary = paymentSummary.get(invoice.id);
        const paidAmount =
          summary?.paidAmount ??
          (typeof meta?.paid_amount === "number" ? Number(meta.paid_amount) : invoice.paidAt ? Number(invoice.total ?? 0) : 0);
        const remainingAmount = Math.max(0, Number(invoice.total ?? 0) - paidAmount);
        return {
          id: invoice.id,
          invoice_number: invoice.invoiceNumber,
          issue_date: invoice.issueDate.toISOString(),
          due_date: invoice.dueDate?.toISOString() ?? null,
          customer_name: invoice.workspace.billingProfile?.legalName ?? invoice.workspace.name,
          subtotal: invoice.subtotal ?? 0,
          vat_amount: invoice.vatAmount ?? 0,
          total: invoice.total,
          total_amount: invoice.total,
          paid_amount: paidAmount,
          remaining_amount: remainingAmount,
          currency: typeof meta?.currency === "string" ? meta.currency : "EUR",
          status: remainingAmount <= 0 && Number(invoice.total ?? 0) > 0 ? "paid" : invoice.status,
          notes: typeof meta?.notes === "string" ? meta.notes : null,
          workspace_id: invoice.workspaceId,
          workspaces: { name: invoice.workspace.name },
        };
      }),
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/admin/invoices/remind-critical", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const bodySchema = z.object({
      invoice_ids: z.array(z.string().uuid()).optional().default([]),
    });
    const input = bodySchema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const invoices = await prisma.platformInvoice.findMany({
      where: input.invoice_ids.length > 0 ? { id: { in: input.invoice_ids } } : { status: { in: ["pending", "overdue"] } },
      select: {
        id: true,
        workspaceId: true,
        invoiceNumber: true,
        total: true,
      },
      take: 200,
    });

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const invoice of invoices) {
        await logSubscriptionEvent(tx, invoice.workspaceId, {
          eventType: "admin.invoice.reminder",
          severity: "warning",
          message: `Lembrete administrativo emitido para ${invoice.invoiceNumber}.`,
          metadata: {
            invoice_id: invoice.id,
            amount: invoice.total,
          },
        });
      }
    });

    return res.json({
      sent: invoices.length,
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/admin/webhooks", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const events = await prisma.subscriptionEvent.findMany({
      where: {
        OR: [
          { eventType: { contains: "webhook" } },
          { eventType: { contains: "stripe" } },
          { eventType: { contains: "portal" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return res.json({
      events: events.map((event: (typeof events)[number]) => ({
        id: event.id,
        created_at: event.createdAt.toISOString(),
        event_type: event.eventType,
        status: event.severity === "warning" ? "retrying" : event.severity === "error" ? "failed" : "processed",
        attempts: 1,
        last_error: event.severity === "error" ? event.message ?? "Erro interno" : null,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/admin/lifecycle/subscriptions", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const subscriptions = await listAdminSubscriptions();
    return res.json({ subscriptions });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/admin/lifecycle/workspaces/:workspaceId/transition", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const { workspaceId } = workspaceIdSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const input = adminLifecycleTransitionSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const nextStatus =
      input.status === "past_due"
        ? "overdue"
        : input.status === "legal_hold"
          ? "suspended"
          : input.status;
    const now = new Date();

    const subscription = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.workspaceSubscription.findUnique({
        where: { workspaceId },
      });

      const updated = await tx.workspaceSubscription.upsert({
        where: { workspaceId },
        update: {
          status: nextStatus,
          cancelledAt: nextStatus === "cancelled" ? now : null,
          graceUntil: nextStatus === "grace_period" ? addDays(now, 7) : null,
          currentPeriodStart: existing?.currentPeriodStart ?? now,
          currentPeriodEnd:
            existing?.currentPeriodEnd ??
            addMonths(now, existing?.billingCycle === "yearly" ? 12 : 1),
        },
        create: {
          workspaceId,
          planCode: existing?.planCode ?? "starter",
          status: nextStatus,
          billingCycle: existing?.billingCycle ?? "monthly",
          trialStartedAt: existing?.trialStartedAt ?? now,
          trialEndsAt: existing?.trialEndsAt ?? addDays(now, 14),
          currentPeriodStart: existing?.currentPeriodStart ?? now,
          currentPeriodEnd:
            existing?.currentPeriodEnd ??
            addMonths(now, existing?.billingCycle === "yearly" ? 12 : 1),
          graceUntil: nextStatus === "grace_period" ? addDays(now, 7) : null,
          cancelledAt: nextStatus === "cancelled" ? now : null,
        },
      });

      await logSubscriptionEvent(tx, workspaceId, {
        eventType: "subscription_status_changed",
        severity: nextStatus === "cancelled" ? "warning" : "info",
        message: input.reason?.trim() || `Estado alterado para ${input.status}.`,
        metadata: {
          requested_status: input.status,
          applied_status: nextStatus,
          legal_hold: input.status === "legal_hold",
          suspension_mode: input.suspension_mode ?? (nextStatus === "suspended" ? "soft" : null),
          reason: input.reason?.trim() || null,
        } as Prisma.InputJsonValue,
      });

      return updated;
    });

    return res.json({
      subscription: {
        id: subscription.id,
        workspace_id: subscription.workspaceId,
        status: subscription.status,
        billing_cycle: subscription.billingCycle,
        current_period_end: subscription.currentPeriodEnd?.toISOString() ?? null,
        grace_until: subscription.graceUntil?.toISOString() ?? null,
        cancelled_at: subscription.cancelledAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/admin/audit-logs", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const events = await prisma.subscriptionEvent.findMany({
      include: {
        workspace: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    });

    return res.json({
      logs: events.map((event: (typeof events)[number]) => ({
        id: event.id,
        workspace_id: event.workspaceId,
        created_at: event.createdAt.toISOString(),
        category: categorizeEvent(event.eventType),
        action: event.eventType,
        severity: event.severity,
        message: event.message ?? null,
        workspaces: event.workspace ? { name: event.workspace.name } : null,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.get("/admin/manual-transfers/pending", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const transfers = await prisma.manualBankTransfer.findMany({
      where: {
        status: {
          in: ["awaiting_transfer", "pending_manual_review"],
        },
      },
      include: {
        workspace: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const invoiceIds = transfers
      .map((transfer: { invoiceId: string | null }) => transfer.invoiceId)
      .filter((invoiceId: string | null): invoiceId is string => !!invoiceId);
    const invoices = invoiceIds.length
      ? await prisma.platformInvoice.findMany({
          where: { id: { in: invoiceIds } },
          select: { id: true, invoiceNumber: true, total: true },
        })
      : [];
    const invoicesById = new Map<string, { id: string; invoiceNumber: string; total: number }>(
      invoices.map((invoice: { id: string; invoiceNumber: string; total: number }) => [
        invoice.id,
        invoice,
      ]),
    );

    return res.json({
      transfers: transfers.map((transfer: {
        id: string;
        workspaceId: string;
        invoiceId: string | null;
        referenceCode: string;
        amount: number;
        currency: string;
        bankAccountId: string | null;
        paymentMethod: string | null;
        transferDate: Date | null;
        proofPath: string | null;
        proofName: string | null;
        notes: string | null;
        reviewerNotes: string | null;
        reviewedAt: Date | null;
        status: string;
        createdAt: Date;
        workspace: { name: string } | null;
      }) => {
        const linkedInvoice = transfer.invoiceId ? invoicesById.get(transfer.invoiceId) ?? null : null;
        return {
          ...mapManualTransfer(transfer),
          workspaces: transfer.workspace ? { name: transfer.workspace.name } : null,
          platform_invoices: linkedInvoice
            ? {
                invoice_number: linkedInvoice.invoiceNumber,
                total: linkedInvoice.total,
              }
            : null,
        };
      }),
    });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/admin/manual-transfers/:transferId/approve", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const paramsSchema = z.object({ transferId: z.string().uuid() });
    const { transferId } = paramsSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const input = manualTransferDecisionSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const now = new Date();

    const transfer = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.manualBankTransfer.update({
        where: { id: transferId },
        data: {
          status: "confirmed",
          reviewerNotes: input.notes ?? null,
          reviewedAt: now,
        },
      });

      if (updated.invoiceId) {
        await tx.platformInvoice.update({
          where: { id: updated.invoiceId },
          data: {
            status: "paid",
            paidAt: now,
          },
        });
      }

      await logSubscriptionEvent(tx, updated.workspaceId, {
        eventType: "invoice_paid",
        severity: "success",
        message: `Transferencia ${updated.referenceCode} aprovada manualmente.`,
      });

      return updated;
    });

    return res.json({ transfer: mapManualTransfer(transfer) });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/admin/manual-transfers/:transferId/reject", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.auth!.role !== "admin") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const paramsSchema = z.object({ transferId: z.string().uuid() });
    const { transferId } = paramsSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const input = manualTransferDecisionSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const now = new Date();

    const transfer = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.manualBankTransfer.update({
        where: { id: transferId },
        data: {
          status: "rejected",
          reviewerNotes: input.notes ?? null,
          reviewedAt: now,
        },
      });

      await logSubscriptionEvent(tx, updated.workspaceId, {
        eventType: "invoice_payment_failed",
        severity: "warning",
        message: `Transferencia ${updated.referenceCode} rejeitada.`,
      });

      return updated;
    });

    return res.json({ transfer: mapManualTransfer(transfer) });
  } catch (error) {
    return next(error);
  }
});

billingRouter.post("/workspaces/:workspaceId/activate-subscription", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = workspaceIdSchema.parse((req as AuthenticatedRequest & { params: unknown }).params);
    const input = activateSchema.parse((req as AuthenticatedRequest & { body: unknown }).body);
    const access = await requireWorkspaceAccess(req, workspaceId);

    if (!access.allowed || !access.workspace) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const now = new Date();
    const periodEnd = addMonths(now, input.cycle === "yearly" ? 12 : 1);

    const subscription = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.workspaceSubscription.upsert({
        where: { workspaceId },
        update: {
          planCode: input.plan_code,
          status: "active",
          billingCycle: input.cycle,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelledAt: null,
        },
        create: {
          workspaceId,
          planCode: input.plan_code,
          status: "active",
          billingCycle: input.cycle,
          trialStartedAt: now,
          trialEndsAt: addDays(now, 14),
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });

      await logSubscriptionEvent(tx, workspaceId, {
        eventType: "subscription_updated",
        severity: "success",
        message: `Subscricao ativada no plano ${input.plan_code} (${input.cycle}).`,
      });

      return updated;
    });

    return res.json({
      subscription: {
        id: subscription.id,
        workspace_id: subscription.workspaceId,
        plan_code: subscription.planCode,
        status: subscription.status,
        billing_cycle: subscription.billingCycle,
        current_period_start: subscription.currentPeriodStart?.toISOString() ?? null,
        current_period_end: subscription.currentPeriodEnd?.toISOString() ?? null,
      },
    });
  } catch (error) {
    return next(error);
  }
});
