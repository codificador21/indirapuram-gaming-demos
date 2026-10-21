CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emoji" text DEFAULT '🏷️' NOT NULL,
	"color" text DEFAULT '#94a3b8' NOT NULL,
	"kind" text DEFAULT 'expense' NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_commitments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fixed_commitments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"amount_paise" bigint NOT NULL,
	"match_keywords" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "merchant_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"merchant_key" text NOT NULL,
	"category_id" text NOT NULL,
	"exclude_from_budget" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "my_accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "my_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"label" text NOT NULL,
	"bank" text,
	"last4" text NOT NULL,
	"type" text DEFAULT 'bank' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "raw_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source" text NOT NULL,
	"via" text DEFAULT 'webhook' NOT NULL,
	"sender" text,
	"subject" text,
	"body" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"external_id" text,
	"content_hash" text NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"parsed" jsonb,
	"transaction_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"monthly_salary_paise" bigint DEFAULT 0 NOT NULL,
	"salary_credit_day" integer DEFAULT 1 NOT NULL,
	"budget_cycle" text DEFAULT 'calendar' NOT NULL,
	"self_identifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone NOT NULL,
	"amount_paise" bigint NOT NULL,
	"direction" text NOT NULL,
	"merchant" text,
	"merchant_key" text,
	"payee" text,
	"bank" text,
	"account_last4" text,
	"account_type" text,
	"channel" text DEFAULT 'other' NOT NULL,
	"reference" text,
	"balance_paise" bigint,
	"category_id" text DEFAULT 'other' NOT NULL,
	"category_source" text DEFAULT 'auto' NOT NULL,
	"credit_kind" text,
	"exclude_from_budget" boolean DEFAULT false NOT NULL,
	"exclude_reason" text,
	"commitment_id" integer,
	"transfer_pair_id" integer,
	"notes" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amount_positive" CHECK ("transactions"."amount_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD CONSTRAINT "merchant_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "raw_messages" ADD CONSTRAINT "raw_messages_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set default ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_commitment_id_fixed_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."fixed_commitments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_rules_key_uq" ON "merchant_rules" USING btree ("merchant_key");--> statement-breakpoint
CREATE UNIQUE INDEX "my_accounts_last4_type_uq" ON "my_accounts" USING btree ("last4","type");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_messages_external_id_uq" ON "raw_messages" USING btree ("external_id") WHERE "raw_messages"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "raw_messages_content_hash_idx" ON "raw_messages" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "raw_messages_status_idx" ON "raw_messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "raw_messages_transaction_idx" ON "raw_messages" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transactions_occurred_at_idx" ON "transactions" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "transactions_reference_idx" ON "transactions" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "transactions_merchant_key_idx" ON "transactions" USING btree ("merchant_key");