import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must have at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  CORS_ORIGIN: z.string().default("http://localhost:8080"),
  PUBLIC_APP_URL: z.string().url().optional().or(z.literal("")),
  EMAIL_FROM: z.string().optional().or(z.literal("")),
  SMTP_HOST: z.string().optional().or(z.literal("")),
  SMTP_PORT: z.preprocess((val) => (val === "" || val === undefined ? undefined : val), z.coerce.number().int().positive().optional()),
  SMTP_USER: z.string().optional().or(z.literal("")),
  SMTP_PASS: z.string().optional().or(z.literal("")),
  SMTP_SECURE: z.preprocess((val) => (val === "" || val === undefined ? undefined : val), z.enum(["true", "false"]).optional()),
  STRIPE_SANDBOX_API_KEY: z.string().optional().or(z.literal("")),
  STRIPE_LIVE_API_KEY: z.string().optional().or(z.literal("")),
  STRIPE_WEBHOOK_SECRET: z.string().optional().or(z.literal("")),
  STRIPE_PORTAL_SANDBOX_URL: z.string().url().optional().or(z.literal("")),
  STRIPE_PORTAL_LIVE_URL: z.string().url().optional().or(z.literal("")),
  PAYMENTS_SANDBOX_WEBHOOK_SECRET: z.string().optional().or(z.literal("")),
  PAYMENTS_LIVE_WEBHOOK_SECRET: z.string().optional().or(z.literal("")),
  GEMINI_API_KEY: z.string().optional().or(z.literal("")),
  OPENAI_API_KEY: z.string().optional().or(z.literal("")),
  MINIO_ENDPOINT: z.string().default("http://minio:9000"),
  MINIO_ROOT_USER: z.string().min(3, "MINIO_ROOT_USER é obrigatório").default("minioadmin"),
  MINIO_ROOT_PASSWORD: z.string().min(16, "MINIO_ROOT_PASSWORD deve ter ao menos 16 caracteres"),
});

export const env = envSchema.parse(process.env);
