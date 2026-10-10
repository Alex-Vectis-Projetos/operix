import { Router, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

const settingsPatchSchema = z.object({
  company_name: z.string().optional(),
  siret: z.string().optional(),
  tva_number: z.string().optional(),
  address: z.string().optional(),
  logo_url: z.string().optional(),
  brand_config: z.record(z.string(), z.any()).nullable().optional(),
  invoice_template: z.record(z.string(), z.any()).nullable().optional(),
  bank_name: z.string().nullable().optional(),
  iban: z.string().nullable().optional(),
  swift_bic: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  postal_code: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  company_email: z.string().nullable().optional(),
  company_phone: z.string().nullable().optional(),
  street_name: z.string().nullable().optional(),
  street_number: z.string().nullable().optional(),
  company_share: z.number().optional(),
  partner_share: z.number().optional(),
  tech_share: z.number().optional(),
});

// GET /api/settings/company — fetch company settings for the authenticated user
settingsRouter.get("/company", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const userId = req.auth!.userId;
    const settings = await prisma.companySetting.findUnique({
      where: { userId },
    });
    if (!settings) {
      return res.json({ settings: null });
    }
    return res.json({
      settings: {
        ...settings,
        company_name: settings.companyName,
        siret: settings.siret,
        tva_number: settings.tvaNnumber,
        company_email: settings.companyEmail,
        company_phone: settings.companyPhone,
        bank_name: settings.bankName,
        iban: settings.iban,
        swift_bic: settings.swiftBic,
        street_number: settings.streetNumber,
        street_name: settings.streetName,
        postal_code: settings.postalCode,
        city: settings.city,
        country: settings.country,
        company_share: settings.companyShare,
        partner_share: settings.partnerShare,
        tech_share: settings.techShare,
      },
    });
  } catch (error) {
    return next(error);
  }
});

// PATCH /api/settings/company — upsert company settings for the authenticated user
settingsRouter.patch("/company", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const userId = req.auth!.userId;
    const input = settingsPatchSchema.parse(req.body);

    // Map snake_case input to Prisma camelCase fields
    const data: Record<string, unknown> = {};
    if (input.company_name !== undefined) data.companyName = input.company_name;
    if (input.siret !== undefined) data.siret = input.siret;
    if (input.tva_number !== undefined) data.tvaNnumber = input.tva_number;
    if (input.address !== undefined) data.address = input.address;
    if (input.logo_url !== undefined) data.logoUrl = input.logo_url;
    if (input.brand_config !== undefined) data.brandConfig = input.brand_config;
    if (input.invoice_template !== undefined) data.invoiceTemplate = input.invoice_template;
    if (input.bank_name !== undefined) data.bankName = input.bank_name;
    if (input.iban !== undefined) data.iban = input.iban;
    if (input.swift_bic !== undefined) data.swiftBic = input.swift_bic;
    if (input.city !== undefined) data.city = input.city;
    if (input.postal_code !== undefined) data.postalCode = input.postal_code;
    if (input.country !== undefined) data.country = input.country;
    if (input.company_email !== undefined) data.companyEmail = input.company_email;
    if (input.company_phone !== undefined) data.companyPhone = input.company_phone;
    if (input.street_name !== undefined) data.streetName = input.street_name;
    if (input.street_number !== undefined) data.streetNumber = input.street_number;
    if (input.company_share !== undefined) data.companyShare = input.company_share;
    if (input.partner_share !== undefined) data.partnerShare = input.partner_share;
    if (input.tech_share !== undefined) data.techShare = input.tech_share;

    const settings = await prisma.companySetting.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});
