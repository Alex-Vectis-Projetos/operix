-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_users" (
    "id" TEXT NOT NULL,
    "auth_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "workspace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "avatar_url" TEXT,
    "display_code" TEXT,
    "is_system_owner" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "source" TEXT NOT NULL DEFAULT 'system',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_profiles" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "billing_email" TEXT NOT NULL,
    "vat_number" TEXT,
    "country" TEXT NOT NULL DEFAULT 'PT',
    "is_business" BOOLEAN NOT NULL DEFAULT true,
    "company_name" TEXT,
    "billing_address" TEXT,
    "city" TEXT,
    "postal_code" TEXT,
    "preferred_currency" TEXT NOT NULL DEFAULT 'EUR',
    "vat_mode" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_subscriptions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL DEFAULT 'starter',
    "status" TEXT NOT NULL DEFAULT 'trial',
    "billing_cycle" TEXT NOT NULL DEFAULT 'monthly',
    "trial_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trial_ends_at" TIMESTAMP(3),
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "grace_until" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "stripe_subscription_id" TEXT,
    "stripe_customer_id" TEXT,
    "stripe_price_lookup_key" TEXT,
    "stripe_environment" TEXT,
    "last_recalculated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "brand" TEXT,
    "last4" TEXT,
    "holder_name" TEXT,
    "iban_masked" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_bank_transfers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "reference_code" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "invoice_id" TEXT,
    "bank_account_id" TEXT,
    "payment_method" TEXT,
    "transfer_date" TIMESTAMP(3),
    "proof_path" TEXT,
    "proof_name" TEXT,
    "notes" TEXT,
    "reviewer_notes" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'awaiting_transfer',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manual_bank_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_invoices" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3),
    "total" DOUBLE PRECISION NOT NULL,
    "subtotal" DOUBLE PRECISION,
    "vat_amount" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMP(3),
    "vat_mode" TEXT,
    "pdf_path" TEXT,
    "pdf_url" TEXT,
    "bank_snapshot" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_bank_accounts" (
    "id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "iban" TEXT,
    "bic" TEXT,
    "country" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "account_type" TEXT NOT NULL DEFAULT 'business',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_clients" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "visibility_scope" TEXT NOT NULL DEFAULT 'workspace',
    "kind" TEXT NOT NULL DEFAULT 'professional',
    "name" TEXT NOT NULL,
    "siren" TEXT,
    "siret" TEXT,
    "tva_intracom" TEXT,
    "tax_id" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "address_complement" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "country" TEXT,
    "iban" TEXT,
    "bic" TEXT,
    "contacts" JSONB,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_suppliers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "document_number" TEXT,
    "tax_id" TEXT,
    "iban" TEXT,
    "bank" TEXT,
    "category" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_invoices" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "visibility_scope" TEXT NOT NULL DEFAULT 'workspace',
    "invoice_number" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'outgoing',
    "supplier_id" TEXT,
    "billing_client_id" TEXT,
    "customer_name" TEXT,
    "customer_snapshot" JSONB,
    "vehicle_id" TEXT,
    "fleet_id" TEXT,
    "service_order_id" TEXT,
    "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3),
    "total_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paid_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remaining_amount" DOUBLE PRECISION DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "metadata" JSONB,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deleted_reason" TEXT,
    "financial_sync_lock" BOOLEAN NOT NULL DEFAULT false,
    "last_financial_event_hash" TEXT,
    "last_financial_sync_at" TIMESTAMP(3),
    "stripe_invoice_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "sync_revision" INTEGER NOT NULL DEFAULT 1,
    "year_reference" INTEGER,

    CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_attachments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "invoice_id" TEXT,
    "payment_id" TEXT,
    "supplier_id" TEXT,
    "billing_client_id" TEXT,
    "file_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_send_log" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "cc" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'self_hosted',
    "status" TEXT NOT NULL DEFAULT 'sent',
    "error" TEXT,
    "idempotency_key" TEXT,
    "pdf_path" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'initial',
    "sent_by" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_send_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backend_event_logs" (
    "id" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "row_id" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "actor_user_id" TEXT,
    "workspace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backend_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platforms" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "color" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "last_heartbeat_at" TIMESTAMP(3),
    "last_ingest_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platforms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "visibility_scope" TEXT NOT NULL DEFAULT 'workspace',
    "name" TEXT NOT NULL,
    "address" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "display_code" TEXT,
    "notes" TEXT,
    "user_id" TEXT,
    "created_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deleted_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_orders" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "visibility_scope" TEXT NOT NULL DEFAULT 'workspace',
    "user_id" TEXT NOT NULL,
    "assigned_user_id" TEXT NOT NULL,
    "client_id" TEXT,
    "client_name" TEXT NOT NULL DEFAULT '',
    "car_name" TEXT,
    "license_plate" TEXT,
    "platform" TEXT,
    "platform_id" TEXT,
    "operational_unit" TEXT,
    "group_id" TEXT,
    "week" TEXT,
    "year_reference" INTEGER,
    "technician_name" TEXT NOT NULL DEFAULT '',
    "technician_earning" DOUBLE PRECISION,
    "technician_percentage" DOUBLE PRECISION,
    "service_1_name" TEXT,
    "service_1_price" DOUBLE PRECISION,
    "service_2_name" TEXT,
    "service_2_price" DOUBLE PRECISION,
    "service_3_name" TEXT,
    "service_3_price" DOUBLE PRECISION,
    "service_4_name" TEXT,
    "service_4_price" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "distribution_snapshot" JSONB,
    "created_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deleted_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "visibility_scope" TEXT NOT NULL DEFAULT 'workspace',
    "user_id" TEXT NOT NULL,
    "assigned_user_id" TEXT NOT NULL,
    "client_id" TEXT,
    "client_name" TEXT,
    "car_name" TEXT,
    "license_plate" TEXT,
    "platform" TEXT,
    "operational_unit" TEXT,
    "group_id" TEXT,
    "list_name" TEXT,
    "year_reference" INTEGER,
    "technician_id" TEXT,
    "technician_name" TEXT,
    "services" JSONB,
    "service_order_id" TEXT,
    "amount_paid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deleted_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "client_id" TEXT,
    "client_name" TEXT,
    "technician_user_id" TEXT,
    "technician_name" TEXT,
    "platform" TEXT,
    "insurer" TEXT,
    "license_plate" TEXT,
    "vin" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "color" TEXT,
    "notes" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'new_vehicle',
    "commercial_status" TEXT,
    "service_order_id" TEXT,
    "due_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_photos" (
    "id" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "caption" TEXT,
    "size_bytes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_invites" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "target_profile_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_by" TEXT NOT NULL,
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "entity_type" TEXT NOT NULL,
    "module" TEXT,
    "type" TEXT NOT NULL DEFAULT 'file',
    "parent_id" TEXT,
    "storage_path" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "rotation" DOUBLE PRECISION DEFAULT 0,
    "zoom" DOUBLE PRECISION DEFAULT 1,
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "visual_state" JSONB,
    "uploaded_by" TEXT,
    "workspace_id" TEXT,
    "issue_date" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "country_requirement_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_records" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "origin" TEXT,
    "category" TEXT,
    "label" TEXT,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "reference_id" TEXT,
    "service_order_id" TEXT,
    "payment_order_id" TEXT,
    "assigned_user_id" TEXT,
    "vehicle_id" TEXT,
    "year_reference" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" TEXT NOT NULL,
    "service_order_id" TEXT,
    "payment_order_id" TEXT,
    "matched_by" TEXT NOT NULL DEFAULT 'auto',
    "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difference_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profit_rules" (
    "id" TEXT NOT NULL,
    "rule_name" TEXT NOT NULL,
    "group_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profit_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profit_rule_items" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "participant_name" TEXT NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "participant_type" TEXT NOT NULL DEFAULT 'other',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profit_rule_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_distributions" (
    "id" TEXT NOT NULL,
    "service_order_id" TEXT NOT NULL,
    "rule_item_id" TEXT,
    "participant_name" TEXT NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "calculated_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_order_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_events" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "event_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "event_hash" TEXT,
    "actor_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_integrity_issues" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "year_reference" INTEGER,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "issue_type" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "reference_id" TEXT,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "details_json" JSONB NOT NULL DEFAULT '{}',
    "hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_integrity_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_integrity_snapshots" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "year_reference" INTEGER NOT NULL,
    "snapshot_type" TEXT NOT NULL DEFAULT 'manual',
    "snapshot_hash" TEXT,
    "total_received" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_expected" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_pending" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_distributed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_expenses" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_profit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_os" INTEGER NOT NULL DEFAULT 0,
    "total_op" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_integrity_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL DEFAULT '',
    "siret" TEXT NOT NULL DEFAULT '',
    "tva_number" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "logo_url" TEXT NOT NULL DEFAULT '',
    "brand_config" JSONB,
    "invoice_template" JSONB,
    "bank_name" TEXT,
    "iban" TEXT,
    "swift_bic" TEXT,
    "city" TEXT,
    "postal_code" TEXT,
    "country" TEXT,
    "company_email" TEXT,
    "company_phone" TEXT,
    "street_name" TEXT,
    "street_number" TEXT,
    "company_share" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "partner_share" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tech_share" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hail_events" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "external_id" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radius_km" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "severity" TEXT NOT NULL DEFAULT 'low',
    "status" TEXT NOT NULL DEFAULT 'forecast',
    "hail_size_mm" DOUBLE PRECISION,
    "probability" DOUBLE PRECISION,
    "intensity" DOUBLE PRECISION,
    "storm_speed_kmh" DOUBLE PRECISION,
    "storm_direction_deg" DOUBLE PRECISION,
    "forecast_time" TIMESTAMP(3),
    "observed_time" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hail_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hail_reports" (
    "id" TEXT NOT NULL,
    "reporter_user_id" TEXT,
    "hail_event_id" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hail_size_mm" DOUBLE PRECISION,
    "severity" TEXT NOT NULL DEFAULT 'low',
    "status" TEXT NOT NULL DEFAULT 'partial',
    "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "corroboration_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "photo_storage_path" TEXT,
    "photo_url" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hail_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_events" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "correlation_key" TEXT,
    "ref_table" TEXT,
    "ref_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_lists" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "list_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'em_elaboracao',
    "previous_status" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "name" TEXT NOT NULL,
    "address_street" TEXT NOT NULL,
    "address_number" TEXT,
    "address_neighborhood" TEXT,
    "address_city" TEXT NOT NULL,
    "address_state" TEXT,
    "address_zip" TEXT,
    "address_country" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "manager_name" TEXT NOT NULL,
    "manager_phone" TEXT,
    "manager_email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "type" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "birth_date" TIMESTAMP(3),
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT,
    "department" TEXT,
    "location_id" TEXT,
    "system_access_user_id" TEXT,
    "tax_id" TEXT,
    "address" TEXT,
    "fiscal_data" JSONB,
    "source_invoice_document_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_identity_documents" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_number" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_identity_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country_document_requirements" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "document_name" TEXT NOT NULL,
    "applies_to" TEXT NOT NULL DEFAULT 'both',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_document_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_users_auth_user_id_key" ON "app_users"("auth_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_display_code_key" ON "profiles"("display_code");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_key" ON "user_roles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_workspace_id_user_id_key" ON "memberships"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_profiles_workspace_id_key" ON "billing_profiles"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_subscriptions_workspace_id_key" ON "workspace_subscriptions"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "manual_bank_transfers_reference_code_key" ON "manual_bank_transfers"("reference_code");

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_invoice_number_key" ON "platform_invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "billing_invoices_workspace_id_issue_date_idx" ON "billing_invoices"("workspace_id", "issue_date");

-- CreateIndex
CREATE INDEX "billing_invoices_billing_client_id_idx" ON "billing_invoices"("billing_client_id");

-- CreateIndex
CREATE INDEX "billing_attachments_invoice_id_idx" ON "billing_attachments"("invoice_id");

-- CreateIndex
CREATE INDEX "billing_attachments_billing_client_id_idx" ON "billing_attachments"("billing_client_id");

-- CreateIndex
CREATE INDEX "invoice_send_log_invoice_id_created_at_idx" ON "invoice_send_log"("invoice_id", "created_at");

-- CreateIndex
CREATE INDEX "backend_event_logs_table_name_row_id_created_at_idx" ON "backend_event_logs"("table_name", "row_id", "created_at");

-- CreateIndex
CREATE INDEX "platforms_workspace_id_idx" ON "platforms"("workspace_id");

-- CreateIndex
CREATE INDEX "platforms_state_idx" ON "platforms"("state");

-- CreateIndex
CREATE UNIQUE INDEX "platforms_workspace_id_slug_key" ON "platforms"("workspace_id", "slug");

-- CreateIndex
CREATE INDEX "clients_workspace_id_idx" ON "clients"("workspace_id");

-- CreateIndex
CREATE INDEX "service_orders_workspace_id_status_idx" ON "service_orders"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "service_orders_client_id_idx" ON "service_orders"("client_id");

-- CreateIndex
CREATE INDEX "payment_orders_workspace_id_status_idx" ON "payment_orders"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "payment_orders_client_id_idx" ON "payment_orders"("client_id");

-- CreateIndex
CREATE INDEX "production_orders_workspace_id_status_idx" ON "production_orders"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "production_photos_production_order_id_idx" ON "production_photos"("production_order_id");

-- CreateIndex
CREATE INDEX "workspace_invites_workspace_id_status_idx" ON "workspace_invites"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "workspace_invites_target_profile_id_status_idx" ON "workspace_invites"("target_profile_id", "status");

-- CreateIndex
CREATE INDEX "documents_entity_type_module_idx" ON "documents"("entity_type", "module");

-- CreateIndex
CREATE INDEX "documents_country_requirement_id_idx" ON "documents"("country_requirement_id");

-- CreateIndex
CREATE INDEX "financial_records_workspace_id_type_category_idx" ON "financial_records"("workspace_id", "type", "category");

-- CreateIndex
CREATE INDEX "financial_records_assigned_user_id_idx" ON "financial_records"("assigned_user_id");

-- CreateIndex
CREATE INDEX "financial_records_year_reference_idx" ON "financial_records"("year_reference");

-- CreateIndex
CREATE INDEX "reconciliations_status_matched_by_idx" ON "reconciliations"("status", "matched_by");

-- CreateIndex
CREATE INDEX "reconciliations_service_order_id_idx" ON "reconciliations"("service_order_id");

-- CreateIndex
CREATE INDEX "reconciliations_payment_order_id_idx" ON "reconciliations"("payment_order_id");

-- CreateIndex
CREATE INDEX "profit_rule_items_rule_id_idx" ON "profit_rule_items"("rule_id");

-- CreateIndex
CREATE INDEX "service_order_distributions_service_order_id_idx" ON "service_order_distributions"("service_order_id");

-- CreateIndex
CREATE INDEX "financial_events_workspace_id_created_at_idx" ON "financial_events"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "financial_events_entity_type_entity_id_idx" ON "financial_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "financial_integrity_issues_workspace_id_year_reference_idx" ON "financial_integrity_issues"("workspace_id", "year_reference");

-- CreateIndex
CREATE INDEX "financial_integrity_issues_status_severity_idx" ON "financial_integrity_issues"("status", "severity");

-- CreateIndex
CREATE INDEX "financial_integrity_snapshots_workspace_id_year_reference_c_idx" ON "financial_integrity_snapshots"("workspace_id", "year_reference", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "company_settings_user_id_key" ON "company_settings"("user_id");

-- CreateIndex
CREATE INDEX "hail_events_status_idx" ON "hail_events"("status");

-- CreateIndex
CREATE INDEX "hail_events_severity_idx" ON "hail_events"("severity");

-- CreateIndex
CREATE INDEX "hail_events_lat_lng_idx" ON "hail_events"("lat", "lng");

-- CreateIndex
CREATE UNIQUE INDEX "hail_events_source_external_id_key" ON "hail_events"("source", "external_id");

-- CreateIndex
CREATE INDEX "hail_reports_lat_lng_idx" ON "hail_reports"("lat", "lng");

-- CreateIndex
CREATE INDEX "hail_reports_observed_at_idx" ON "hail_reports"("observed_at");

-- CreateIndex
CREATE INDEX "hail_reports_status_idx" ON "hail_reports"("status");

-- CreateIndex
CREATE INDEX "hail_reports_hail_event_id_idx" ON "hail_reports"("hail_event_id");

-- CreateIndex
CREATE INDEX "operational_events_workspace_id_occurred_at_idx" ON "operational_events"("workspace_id", "occurred_at");

-- CreateIndex
CREATE INDEX "operational_events_severity_occurred_at_idx" ON "operational_events"("severity", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "production_lists_list_name_key" ON "production_lists"("list_name");

-- CreateIndex
CREATE INDEX "production_lists_workspace_id_status_idx" ON "production_lists"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "locations_workspace_id_status_idx" ON "locations"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "locations_address_country_idx" ON "locations"("address_country");

-- CreateIndex
CREATE INDEX "people_workspace_id_type_status_idx" ON "people"("workspace_id", "type", "status");

-- CreateIndex
CREATE INDEX "people_location_id_idx" ON "people"("location_id");

-- CreateIndex
CREATE INDEX "people_tax_id_idx" ON "people"("tax_id");

-- CreateIndex
CREATE INDEX "person_identity_documents_person_id_idx" ON "person_identity_documents"("person_id");

-- CreateIndex
CREATE INDEX "country_document_requirements_country_active_idx" ON "country_document_requirements"("country", "active");

-- CreateIndex
CREATE UNIQUE INDEX "country_document_requirements_country_document_name_key" ON "country_document_requirements"("country", "document_name");

-- AddForeignKey
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_bank_transfers" ADD CONSTRAINT "manual_bank_transfers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_clients" ADD CONSTRAINT "billing_clients_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_suppliers" ADD CONSTRAINT "billing_suppliers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_billing_client_id_fkey" FOREIGN KEY ("billing_client_id") REFERENCES "billing_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "billing_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_attachments" ADD CONSTRAINT "billing_attachments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_attachments" ADD CONSTRAINT "billing_attachments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "billing_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_attachments" ADD CONSTRAINT "billing_attachments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "billing_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_attachments" ADD CONSTRAINT "billing_attachments_billing_client_id_fkey" FOREIGN KEY ("billing_client_id") REFERENCES "billing_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_send_log" ADD CONSTRAINT "invoice_send_log_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "billing_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backend_event_logs" ADD CONSTRAINT "backend_event_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_photos" ADD CONSTRAINT "production_photos_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_country_requirement_id_fkey" FOREIGN KEY ("country_requirement_id") REFERENCES "country_document_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_rule_items" ADD CONSTRAINT "profit_rule_items_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "profit_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hail_reports" ADD CONSTRAINT "hail_reports_hail_event_id_fkey" FOREIGN KEY ("hail_event_id") REFERENCES "hail_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_identity_documents" ADD CONSTRAINT "person_identity_documents_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

