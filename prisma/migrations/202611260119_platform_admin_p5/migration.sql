BEGIN;
-- ADR 0077. Additive commercial ownership and append-only financial history.
CREATE TABLE "CommerceCustomer" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"spaceId" uuid,
"scopeId" uuid,
"kind" varchar(12) NOT NULL,
"revision" integer NOT NULL DEFAULT 1,
"closedAt" timestamptz(3),
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("spaceId","scopeId")
);

CREATE TABLE "CommerceFinancialGrant" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"customerId" uuid NOT NULL,
"userId" uuid NOT NULL,
"revokedAt" timestamptz(3),
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("customerId","userId")
);

CREATE TABLE "CommerceFeature" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"key" varchar(100) NOT NULL UNIQUE,
"name" varchar(160) NOT NULL,
"kind" varchar(8) NOT NULL,
"binding" varchar(100) UNIQUE,
"enforced" boolean NOT NULL DEFAULT false,
"revision" integer NOT NULL DEFAULT 1,
"archived" boolean NOT NULL DEFAULT false,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CommerceProduct" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"name" varchar(160) NOT NULL,
"kind" varchar(8) NOT NULL,
"visibility" varchar(10) NOT NULL,
"pricingPage" boolean NOT NULL DEFAULT false,
"eligibility" jsonb NOT NULL,
"archived" boolean NOT NULL DEFAULT false,
"revision" integer NOT NULL DEFAULT 1,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CommerceTarget" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"productId" uuid NOT NULL,
"customerId" uuid NOT NULL,
UNIQUE ("productId","customerId")
);

CREATE TABLE "CommerceVersion" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"productId" uuid NOT NULL,
"version" integer NOT NULL,
"propagation" varchar(12) NOT NULL,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("productId","version")
);

CREATE TABLE "CommerceAllowance" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"versionId" uuid NOT NULL,
"featureId" uuid NOT NULL,
"value" bigint NOT NULL,
UNIQUE ("versionId","featureId")
);

CREATE TABLE "CommercePrice" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"versionId" uuid NOT NULL,
"customerId" uuid,
"currency" char(3) NOT NULL,
"amount" numeric(24,0) NOT NULL,
"termDays" integer,
"recurring" boolean NOT NULL DEFAULT false,
"complimentary" boolean NOT NULL DEFAULT false,
"active" boolean NOT NULL DEFAULT true,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("id","currency")
);

CREATE TABLE "CommerceSubscription" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"customerId" uuid NOT NULL,
"productId" uuid NOT NULL,
"versionId" uuid NOT NULL,
"priceId" uuid NOT NULL,
"kind" varchar(8) NOT NULL,
"state" varchar(12) NOT NULL,
"startsAt" timestamptz(3) NOT NULL,
"endsAt" timestamptz(3),
"origin" varchar(16) NOT NULL,
"cancelAtEnd" boolean NOT NULL DEFAULT false,
"renewal" varchar(12) NOT NULL,
"pausedAt" timestamptz(3),
"pauseClock" varchar(8),
"graceDays" integer NOT NULL,
"graceWritable" boolean NOT NULL,
"scheduledPriceId" uuid,
"scheduledChange" varchar(12),
"renewalPriceId" uuid,
"renewalPriceAt" timestamptz(3),
"revision" integer NOT NULL DEFAULT 1,
"nextAt" timestamptz(3) NOT NULL,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("id","customerId"),
"scheduledOrigin" varchar(16)
);
CREATE INDEX "CommerceSubscription_nextAt_id_idx" ON "CommerceSubscription" ("nextAt","id");
CREATE TABLE "CommerceTerm" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"subscriptionId" uuid NOT NULL,
"versionId" uuid NOT NULL,
"priceId" uuid NOT NULL,
"startsAt" timestamptz(3) NOT NULL,
"endsAt" timestamptz(3),
"currency" char(3) NOT NULL,
"amount" numeric(24,0) NOT NULL,
"origin" varchar(16) NOT NULL,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("id","subscriptionId")
);

CREATE TABLE "CommerceOverride" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"customerId" uuid NOT NULL,
"featureId" uuid NOT NULL,
"value" bigint NOT NULL,
"mode" varchar(8) NOT NULL,
"duration" varchar(8) NOT NULL,
"expiresAt" timestamptz(3),
"termId" uuid,
"revokedAt" timestamptz(3),
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CommerceInvoice" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"customerId" uuid NOT NULL,
"subscriptionId" uuid,
"number" varchar(80) NOT NULL UNIQUE,
"currency" char(3) NOT NULL,
"state" varchar(8) NOT NULL,
"revision" integer NOT NULL DEFAULT 1,
"currentVersion" integer NOT NULL DEFAULT 1,
"issuedAt" timestamptz(3),
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("id","customerId","currency"),
UNIQUE ("id","customerId")
);

CREATE TABLE "CommerceInvoiceVersion" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"invoiceId" uuid NOT NULL,
"version" integer NOT NULL,
"subtotal" numeric(24,0) NOT NULL,
"discount" numeric(24,0) NOT NULL DEFAULT 0,
"tax" numeric(24,0) NOT NULL DEFAULT 0,
"fee" numeric(24,0) NOT NULL DEFAULT 0,
"total" numeric(24,0) NOT NULL,
"description" varchar(500) NOT NULL,
"calculation" jsonb NOT NULL,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("invoiceId","version"),
UNIQUE ("id","invoiceId")
);

CREATE TABLE "CommerceAdjustment" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"invoiceId" uuid NOT NULL,
"versionId" uuid NOT NULL,
"currency" char(3) NOT NULL,
"amount" numeric(24,0) NOT NULL,
"kind" varchar(16) NOT NULL,
"reason" varchar(500) NOT NULL,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("versionId")
);

CREATE TABLE "CommerceMethod" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"name" varchar(100) NOT NULL,
"kind" varchar(16) NOT NULL,
"referenceNamespace" varchar(100) NOT NULL UNIQUE,
"active" boolean NOT NULL DEFAULT true,
"revision" integer NOT NULL DEFAULT 1,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CommercePayment" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"customerId" uuid NOT NULL,
"invoiceId" uuid,
"subscriptionId" uuid,
"methodId" uuid NOT NULL,
"reference" varchar(160) NOT NULL,
"currency" char(3) NOT NULL,
"amount" numeric(24,0) NOT NULL,
"state" varchar(10) NOT NULL,
"overpayment" varchar(16) NOT NULL,
"evidenceFileId" uuid,
"verifiedAt" timestamptz(3),
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("methodId","reference"),
UNIQUE ("id","customerId","currency"),
"termId" uuid
);

CREATE TABLE "CommerceRefund" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"customerId" uuid NOT NULL,
"paymentId" uuid NOT NULL,
"currency" char(3) NOT NULL,
"amount" numeric(24,0) NOT NULL,
"reference" varchar(160) NOT NULL UNIQUE,
"reason" varchar(500) NOT NULL,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CommerceLedger" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"customerId" uuid NOT NULL,
"invoiceId" uuid,
"paymentId" uuid,
"refundId" uuid,
"adjustmentId" uuid,
"subscriptionId" uuid,
"currency" char(3) NOT NULL,
"amount" numeric(24,0) NOT NULL,
"kind" varchar(24) NOT NULL,
"sourceKey" varchar(160) NOT NULL UNIQUE,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CommerceLedger_customerId_currency_createdAt_idx" ON "CommerceLedger" ("customerId","currency","createdAt");
CREATE TABLE "CommercePromotion" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"code" varchar(80) NOT NULL UNIQUE,
"visibility" varchar(8) NOT NULL,
"kind" varchar(8) NOT NULL,
"amount" numeric(24,0) NOT NULL,
"currency" char(3),
"startsAt" timestamptz(3) NOT NULL,
"endsAt" timestamptz(3) NOT NULL,
"maxUses" integer NOT NULL,
"perCustomer" integer NOT NULL,
"combinable" boolean NOT NULL DEFAULT false,
"productId" uuid,
"customerId" uuid,
"active" boolean NOT NULL DEFAULT true,
"revision" integer NOT NULL DEFAULT 1,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CommerceRedemption" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"promotionId" uuid NOT NULL,
"customerId" uuid NOT NULL,
"invoiceId" uuid NOT NULL,
"versionId" uuid NOT NULL,
"amount" numeric(24,0) NOT NULL,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("promotionId","invoiceId")
);

CREATE TABLE "CommerceEvent" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"customerId" uuid NOT NULL,
"subscriptionId" uuid,
"actorAdminId" uuid,
"actorUserId" uuid,
"kind" varchar(40) NOT NULL,
"reason" varchar(500) NOT NULL,
"metadata" jsonb NOT NULL,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CommerceNotice" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"customerId" uuid NOT NULL,
"subscriptionId" uuid,
"key" varchar(160) NOT NULL UNIQUE,
"kind" varchar(40) NOT NULL,
"dueAt" timestamptz(3) NOT NULL,
"publishedAt" timestamptz(3),
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CommerceNotice_dueAt_id_idx" ON "CommerceNotice" ("dueAt","id");
CREATE TABLE "CommerceReceipt" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"userId" uuid NOT NULL,
"customerId" uuid NOT NULL,
"operation" varchar(80) NOT NULL,
"keyHash" char(64) NOT NULL,
"fingerprint" char(64) NOT NULL,
"result" jsonb NOT NULL,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("userId","operation","keyHash")
);

CREATE TABLE "CommercePolicy" (
"id" varchar(12) NOT NULL PRIMARY KEY,
"revision" integer NOT NULL DEFAULT 1,
"enforcement" boolean NOT NULL DEFAULT false,
"graceDays" integer NOT NULL DEFAULT 7,
"graceWritable" boolean NOT NULL DEFAULT false,
"preExpiryDays" integer NOT NULL DEFAULT 7,
"postExpiryDays" integer NOT NULL DEFAULT 1,
"retryCount" integer NOT NULL DEFAULT 0,
"retryHours" integer NOT NULL DEFAULT 24,
"taxBps" integer NOT NULL DEFAULT 0,
"feeBps" integer NOT NULL DEFAULT 0,
"writeOffMaximum" numeric(24,0) NOT NULL DEFAULT 0,
"updatedAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CommerceRenewal" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"customerId" uuid NOT NULL,
"subscriptionId" uuid NOT NULL,
"invoiceId" uuid NOT NULL,
"priceId" uuid NOT NULL,
"expectedRevision" integer NOT NULL,
"state" varchar(10) NOT NULL,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("invoiceId")
);

ALTER TABLE "CommerceCustomer" ADD CONSTRAINT "CommerceCustomer_spaceId_fk" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "CommerceCustomer" ADD CONSTRAINT "CommerceCustomer_scopeId_fk" FOREIGN KEY ("scopeId") REFERENCES "AccessScope"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "CommerceFinancialGrant" ADD CONSTRAINT "CommerceFinancialGrant_customerId_fk" FOREIGN KEY ("customerId") REFERENCES "CommerceCustomer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceFinancialGrant" ADD CONSTRAINT "CommerceFinancialGrant_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "CommerceTarget" ADD CONSTRAINT "CommerceTarget_productId_fk" FOREIGN KEY ("productId") REFERENCES "CommerceProduct"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceTarget" ADD CONSTRAINT "CommerceTarget_customerId_fk" FOREIGN KEY ("customerId") REFERENCES "CommerceCustomer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceVersion" ADD CONSTRAINT "CommerceVersion_productId_fk" FOREIGN KEY ("productId") REFERENCES "CommerceProduct"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceAllowance" ADD CONSTRAINT "CommerceAllowance_versionId_fk" FOREIGN KEY ("versionId") REFERENCES "CommerceVersion"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceAllowance" ADD CONSTRAINT "CommerceAllowance_featureId_fk" FOREIGN KEY ("featureId") REFERENCES "CommerceFeature"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommercePrice" ADD CONSTRAINT "CommercePrice_versionId_fk" FOREIGN KEY ("versionId") REFERENCES "CommerceVersion"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommercePrice" ADD CONSTRAINT "CommercePrice_customerId_fk" FOREIGN KEY ("customerId") REFERENCES "CommerceCustomer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceSubscription" ADD CONSTRAINT "CommerceSubscription_customerId_fk" FOREIGN KEY ("customerId") REFERENCES "CommerceCustomer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceSubscription" ADD CONSTRAINT "CommerceSubscription_productId_fk" FOREIGN KEY ("productId") REFERENCES "CommerceProduct"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceSubscription" ADD CONSTRAINT "CommerceSubscription_versionId_fk" FOREIGN KEY ("versionId") REFERENCES "CommerceVersion"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceSubscription" ADD CONSTRAINT "CommerceSubscription_priceId_fk" FOREIGN KEY ("priceId") REFERENCES "CommercePrice"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceSubscription" ADD CONSTRAINT "CommerceSubscription_scheduledPriceId_fk" FOREIGN KEY ("scheduledPriceId") REFERENCES "CommercePrice"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceSubscription" ADD CONSTRAINT "CommerceSubscription_renewalPriceId_fk" FOREIGN KEY ("renewalPriceId") REFERENCES "CommercePrice"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceTerm" ADD CONSTRAINT "CommerceTerm_subscriptionId_fk" FOREIGN KEY ("subscriptionId") REFERENCES "CommerceSubscription"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceTerm" ADD CONSTRAINT "CommerceTerm_versionId_fk" FOREIGN KEY ("versionId") REFERENCES "CommerceVersion"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceTerm" ADD CONSTRAINT "CommerceTerm_priceId_fk" FOREIGN KEY ("priceId") REFERENCES "CommercePrice"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceOverride" ADD CONSTRAINT "CommerceOverride_customerId_fk" FOREIGN KEY ("customerId") REFERENCES "CommerceCustomer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceOverride" ADD CONSTRAINT "CommerceOverride_featureId_fk" FOREIGN KEY ("featureId") REFERENCES "CommerceFeature"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceOverride" ADD CONSTRAINT "CommerceOverride_termId_fk" FOREIGN KEY ("termId") REFERENCES "CommerceTerm"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceInvoice" ADD CONSTRAINT "CommerceInvoice_customerId_fk" FOREIGN KEY ("customerId") REFERENCES "CommerceCustomer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceInvoice" ADD CONSTRAINT "CommerceInvoice_subscriptionId_fk" FOREIGN KEY ("subscriptionId","customerId") REFERENCES "CommerceSubscription"("id","customerId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceInvoiceVersion" ADD CONSTRAINT "CommerceInvoiceVersion_invoiceId_fk" FOREIGN KEY ("invoiceId") REFERENCES "CommerceInvoice"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceAdjustment" ADD CONSTRAINT "CommerceAdjustment_invoiceId_fk" FOREIGN KEY ("invoiceId") REFERENCES "CommerceInvoice"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceAdjustment" ADD CONSTRAINT "CommerceAdjustment_versionId_fk" FOREIGN KEY ("versionId","invoiceId") REFERENCES "CommerceInvoiceVersion"("id","invoiceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommercePayment" ADD CONSTRAINT "CommercePayment_customerId_fk" FOREIGN KEY ("customerId") REFERENCES "CommerceCustomer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommercePayment" ADD CONSTRAINT "CommercePayment_invoiceId_fk" FOREIGN KEY ("invoiceId","customerId","currency") REFERENCES "CommerceInvoice"("id","customerId","currency") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommercePayment" ADD CONSTRAINT "CommercePayment_subscriptionId_fk" FOREIGN KEY ("subscriptionId","customerId") REFERENCES "CommerceSubscription"("id","customerId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommercePayment" ADD CONSTRAINT "CommercePayment_methodId_fk" FOREIGN KEY ("methodId") REFERENCES "CommerceMethod"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommercePayment" ADD CONSTRAINT "CommercePayment_evidenceFileId_fk" FOREIGN KEY ("evidenceFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "CommerceRefund" ADD CONSTRAINT "CommerceRefund_paymentId_fk" FOREIGN KEY ("paymentId","customerId","currency") REFERENCES "CommercePayment"("id","customerId","currency") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceLedger" ADD CONSTRAINT "CommerceLedger_customerId_fk" FOREIGN KEY ("customerId") REFERENCES "CommerceCustomer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceLedger" ADD CONSTRAINT "CommerceLedger_refundId_fk" FOREIGN KEY ("refundId") REFERENCES "CommerceRefund"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceLedger" ADD CONSTRAINT "CommerceLedger_adjustmentId_fk" FOREIGN KEY ("adjustmentId") REFERENCES "CommerceAdjustment"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceLedger" ADD CONSTRAINT "CommerceLedger_subscriptionId_fk" FOREIGN KEY ("subscriptionId") REFERENCES "CommerceSubscription"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceLedger" ADD CONSTRAINT "CommerceLedger_invoiceId_fk" FOREIGN KEY ("invoiceId","customerId","currency") REFERENCES "CommerceInvoice"("id","customerId","currency") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceLedger" ADD CONSTRAINT "CommerceLedger_paymentId_fk" FOREIGN KEY ("paymentId","customerId","currency") REFERENCES "CommercePayment"("id","customerId","currency") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommercePromotion" ADD CONSTRAINT "CommercePromotion_productId_fk" FOREIGN KEY ("productId") REFERENCES "CommerceProduct"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommercePromotion" ADD CONSTRAINT "CommercePromotion_customerId_fk" FOREIGN KEY ("customerId") REFERENCES "CommerceCustomer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceRedemption" ADD CONSTRAINT "CommerceRedemption_promotionId_fk" FOREIGN KEY ("promotionId") REFERENCES "CommercePromotion"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceRedemption" ADD CONSTRAINT "CommerceRedemption_customerId_fk" FOREIGN KEY ("customerId") REFERENCES "CommerceCustomer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceRedemption" ADD CONSTRAINT "CommerceRedemption_invoiceId_fk" FOREIGN KEY ("invoiceId","customerId") REFERENCES "CommerceInvoice"("id","customerId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceRedemption" ADD CONSTRAINT "CommerceRedemption_versionId_fk" FOREIGN KEY ("versionId","invoiceId") REFERENCES "CommerceInvoiceVersion"("id","invoiceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceEvent" ADD CONSTRAINT "CommerceEvent_customerId_fk" FOREIGN KEY ("customerId") REFERENCES "CommerceCustomer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceEvent" ADD CONSTRAINT "CommerceEvent_subscriptionId_fk" FOREIGN KEY ("subscriptionId","customerId") REFERENCES "CommerceSubscription"("id","customerId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceEvent" ADD CONSTRAINT "CommerceEvent_actorAdminId_fk" FOREIGN KEY ("actorAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "CommerceEvent" ADD CONSTRAINT "CommerceEvent_actorUserId_fk" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "CommerceNotice" ADD CONSTRAINT "CommerceNotice_customerId_fk" FOREIGN KEY ("customerId") REFERENCES "CommerceCustomer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceNotice" ADD CONSTRAINT "CommerceNotice_subscriptionId_fk" FOREIGN KEY ("subscriptionId","customerId") REFERENCES "CommerceSubscription"("id","customerId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceReceipt" ADD CONSTRAINT "CommerceReceipt_customerId_fk" FOREIGN KEY ("customerId") REFERENCES "CommerceCustomer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceReceipt" ADD CONSTRAINT "CommerceReceipt_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "CommercePayment" ADD CONSTRAINT "CommercePayment_termId_fk" FOREIGN KEY ("termId") REFERENCES "CommerceTerm"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceRenewal" ADD CONSTRAINT "CommerceRenewal_customerId_fk" FOREIGN KEY ("customerId") REFERENCES "CommerceCustomer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceRenewal" ADD CONSTRAINT "CommerceRenewal_subscriptionId_fk" FOREIGN KEY ("subscriptionId","customerId") REFERENCES "CommerceSubscription"("id","customerId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceRenewal" ADD CONSTRAINT "CommerceRenewal_invoiceId_fk" FOREIGN KEY ("invoiceId","customerId") REFERENCES "CommerceInvoice"("id","customerId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceRenewal" ADD CONSTRAINT "CommerceRenewal_priceId_fk" FOREIGN KEY ("priceId") REFERENCES "CommercePrice"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CommerceCustomer" ADD CONSTRAINT "CommerceCustomer_check" CHECK (kind IN ('PERSONAL','TEAM','COMPANY') AND revision>0 AND ("closedAt" IS NOT NULL OR ("spaceId" IS NOT NULL AND ((kind='PERSONAL' AND "scopeId" IS NULL) OR (kind<>'PERSONAL' AND "scopeId" IS NOT NULL)))));
ALTER TABLE "CommerceFeature" ADD CONSTRAINT "CommerceFeature_check" CHECK (kind IN ('BOOLEAN','QUOTA') AND revision>0);
ALTER TABLE "CommerceProduct" ADD CONSTRAINT "CommerceProduct_check" CHECK (kind IN ('PLAN','ADDON') AND visibility IN ('PUBLIC','PRIVATE','TARGETED') AND revision>0 AND jsonb_typeof(eligibility)='array');
ALTER TABLE "CommerceVersion" ADD CONSTRAINT "CommerceVersion_check" CHECK (version>0 AND propagation IN ('NEW_ONLY','ALL'));
ALTER TABLE "CommerceAllowance" ADD CONSTRAINT "CommerceAllowance_check" CHECK (value>=0);
ALTER TABLE "CommercePrice" ADD CONSTRAINT "CommercePrice_check" CHECK (amount>=0 AND currency~'^[A-Z]{3}$' AND ("termDays" IS NULL OR "termDays" BETWEEN 1 AND 36500) AND (NOT complimentary OR amount=0) AND (NOT recurring OR "termDays" IS NOT NULL));
ALTER TABLE "CommerceSubscription" ADD CONSTRAINT "CommerceSubscription_check" CHECK (kind IN ('PLAN','ADDON') AND state IN ('SCHEDULED','ACTIVE','PAUSED','GRACE','EXPIRED','CANCELED') AND origin IN ('COMPLIMENTARY','EXTERNAL') AND renewal IN ('MANUAL','FIXED') AND ("endsAt" IS NULL OR "endsAt">"startsAt") AND "graceDays" BETWEEN 0 AND 365 AND revision>0 AND ("pauseClock" IS NULL OR "pauseClock" IN ('FREEZE','CONTINUE')) AND ((state='PAUSED')=("pausedAt" IS NOT NULL)));
ALTER TABLE "CommerceTerm" ADD CONSTRAINT "CommerceTerm_check" CHECK (amount>=0 AND ("endsAt" IS NULL OR "endsAt">"startsAt") AND origin IN ('COMPLIMENTARY','EXTERNAL') AND (origin<>'COMPLIMENTARY' OR amount=0));
ALTER TABLE "CommerceOverride" ADD CONSTRAINT "CommerceOverride_check" CHECK (value>=0 AND mode IN ('ADD','CAP') AND duration IN ('LIFETIME','DATE','TERM') AND ((duration='DATE')=("expiresAt" IS NOT NULL)) AND ((duration='TERM')=("termId" IS NOT NULL)));
ALTER TABLE "CommerceInvoice" ADD CONSTRAINT "CommerceInvoice_check" CHECK (state IN ('DRAFT','ISSUED','PAID','VOIDED') AND revision>0 AND "currentVersion">0);
ALTER TABLE "CommerceInvoiceVersion" ADD CONSTRAINT "CommerceInvoiceVersion_check" CHECK (version>0 AND subtotal>=0 AND discount>=0 AND discount<=subtotal AND tax>=0 AND fee>=0 AND total=subtotal-discount+tax+fee);
ALTER TABLE "CommerceAdjustment" ADD CONSTRAINT "CommerceAdjustment_check" CHECK (kind IN ('CORRECTION','VOID','WRITE_OFF'));
ALTER TABLE "CommerceMethod" ADD CONSTRAINT "CommerceMethod_check" CHECK (kind IN ('MANUAL','TRANSFER','CRYPTO','FUTURE_PROVIDER') AND revision>0 AND (kind<>'FUTURE_PROVIDER' OR NOT active));
ALTER TABLE "CommercePayment" ADD CONSTRAINT "CommercePayment_check" CHECK (amount>0 AND state IN ('PENDING','VERIFIED','REJECTED') AND overpayment IN ('REJECT','CREDIT','REFUND_PENDING') AND ((state='VERIFIED')=("verifiedAt" IS NOT NULL)));
ALTER TABLE "CommerceRefund" ADD CONSTRAINT "CommerceRefund_check" CHECK (amount>0);
ALTER TABLE "CommerceLedger" ADD CONSTRAINT "CommerceLedger_check" CHECK (kind IN ('CHARGE','ADJUSTMENT','PAYMENT','CREDIT_GRANT','CREDIT_APPLY','CREDIT_REFUND','CREDIT_TRANSFER','REFUND_LIABILITY','REFUND','WRITE_OFF'));
ALTER TABLE "CommercePromotion" ADD CONSTRAINT "CommercePromotion_check" CHECK (kind IN ('PERCENT','FIXED') AND visibility IN ('PUBLIC','PRIVATE') AND amount>0 AND (kind<>'PERCENT' OR amount<=10000) AND ((kind='FIXED')=(currency IS NOT NULL)) AND "endsAt">"startsAt" AND "maxUses" BETWEEN 1 AND 100000000 AND "perCustomer" BETWEEN 1 AND "maxUses" AND revision>0);
ALTER TABLE "CommerceRedemption" ADD CONSTRAINT "CommerceRedemption_check" CHECK (amount>=0);
ALTER TABLE "CommercePolicy" ADD CONSTRAINT "CommercePolicy_check" CHECK (id='GLOBAL' AND revision>0 AND "graceDays" BETWEEN 0 AND 365 AND "preExpiryDays" BETWEEN 0 AND 365 AND "postExpiryDays" BETWEEN 0 AND 365 AND "retryCount" BETWEEN 0 AND 10 AND "retryHours" BETWEEN 1 AND 720 AND "taxBps" BETWEEN 0 AND 10000 AND "feeBps" BETWEEN 0 AND 10000 AND "writeOffMaximum">=0);

CREATE UNIQUE INDEX "CommerceCustomer_personal_unique" ON "CommerceCustomer"("spaceId") WHERE kind='PERSONAL' AND "spaceId" IS NOT NULL;
CREATE UNIQUE INDEX "CommerceCustomer_scope_unique" ON "CommerceCustomer"("scopeId") WHERE "scopeId" IS NOT NULL;
CREATE UNIQUE INDEX "CommerceSubscription_one_base" ON "CommerceSubscription"("customerId") WHERE kind='PLAN' AND state IN ('SCHEDULED','ACTIVE','PAUSED','GRACE');
CREATE UNIQUE INDEX "CommerceSubscription_one_addon" ON "CommerceSubscription"("customerId","productId") WHERE kind='ADDON' AND state IN ('SCHEDULED','ACTIVE','PAUSED','GRACE');
CREATE UNIQUE INDEX "CommerceOverride_final_cap" ON "CommerceOverride"("customerId","featureId") WHERE mode='CAP' AND "revokedAt" IS NULL;
CREATE FUNCTION commerce_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION 'IMMUTABLE_COMMERCIAL_HISTORY' USING ERRCODE='23514'; END $fn$;
CREATE TRIGGER "CommerceVersion_immutable" BEFORE UPDATE OR DELETE ON "CommerceVersion" FOR EACH ROW EXECUTE FUNCTION commerce_immutable();
CREATE TRIGGER "CommerceAllowance_immutable" BEFORE UPDATE OR DELETE ON "CommerceAllowance" FOR EACH ROW EXECUTE FUNCTION commerce_immutable();
CREATE TRIGGER "CommerceTerm_immutable" BEFORE UPDATE OR DELETE ON "CommerceTerm" FOR EACH ROW EXECUTE FUNCTION commerce_immutable();
CREATE TRIGGER "CommerceInvoiceVersion_immutable" BEFORE UPDATE OR DELETE ON "CommerceInvoiceVersion" FOR EACH ROW EXECUTE FUNCTION commerce_immutable();
CREATE TRIGGER "CommerceAdjustment_immutable" BEFORE UPDATE OR DELETE ON "CommerceAdjustment" FOR EACH ROW EXECUTE FUNCTION commerce_immutable();
CREATE TRIGGER "CommerceRefund_immutable" BEFORE UPDATE OR DELETE ON "CommerceRefund" FOR EACH ROW EXECUTE FUNCTION commerce_immutable();
CREATE TRIGGER "CommerceLedger_immutable" BEFORE UPDATE OR DELETE ON "CommerceLedger" FOR EACH ROW EXECUTE FUNCTION commerce_immutable();
CREATE TRIGGER "CommerceRedemption_immutable" BEFORE UPDATE OR DELETE ON "CommerceRedemption" FOR EACH ROW EXECUTE FUNCTION commerce_immutable();

CREATE FUNCTION commerce_customer_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RETAIN_COMMERCIAL_CUSTOMER' USING ERRCODE='23514'; END IF;
 IF NEW.kind<>OLD.kind OR (NEW."spaceId" IS DISTINCT FROM OLD."spaceId" AND NEW."spaceId" IS NOT NULL) OR (NEW."scopeId" IS DISTINCT FROM OLD."scopeId" AND NEW."scopeId" IS NOT NULL) THEN RAISE EXCEPTION 'NO_CUSTOMER_TRANSFER' USING ERRCODE='23514'; END IF;
 IF NEW."spaceId" IS NULL OR (NEW.kind<>'PERSONAL' AND NEW."scopeId" IS NULL) THEN NEW."closedAt"=COALESCE(NEW."closedAt",clock_timestamp()); END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER "CommerceCustomer_guard" BEFORE UPDATE OR DELETE ON "CommerceCustomer" FOR EACH ROW EXECUTE FUNCTION commerce_customer_guard();
CREATE FUNCTION commerce_price_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'active') IS DISTINCT FROM (to_jsonb(OLD)-'active') THEN RAISE EXCEPTION 'VERSION_PRICE_INSTEAD' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER "CommercePrice_guard" BEFORE UPDATE OR DELETE ON "CommercePrice" FOR EACH ROW EXECUTE FUNCTION commerce_price_guard();
CREATE FUNCTION commerce_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF TG_OP='DELETE' OR (OLD.state<>'PENDING' AND (to_jsonb(NEW)-'evidenceFileId') IS DISTINCT FROM (to_jsonb(OLD)-'evidenceFileId')) OR NEW."customerId"<>OLD."customerId" OR NEW.amount<>OLD.amount OR NEW.currency<>OLD.currency OR NEW.reference<>OLD.reference OR NEW."methodId"<>OLD."methodId" OR NEW."invoiceId" IS DISTINCT FROM OLD."invoiceId" OR NEW."subscriptionId" IS DISTINCT FROM OLD."subscriptionId" OR (NEW."evidenceFileId" IS DISTINCT FROM OLD."evidenceFileId" AND NEW."evidenceFileId" IS NOT NULL) THEN RAISE EXCEPTION 'IMMUTABLE_PAYMENT_HISTORY' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER "CommercePayment_guard" BEFORE UPDATE OR DELETE ON "CommercePayment" FOR EACH ROW EXECUTE FUNCTION commerce_payment_guard();
CREATE FUNCTION commerce_correction_pair() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF NEW.version>1 AND EXISTS(SELECT 1 FROM "CommerceInvoice" WHERE id=NEW."invoiceId" AND "issuedAt" IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM "CommerceAdjustment" WHERE "versionId"=NEW.id AND "invoiceId"=NEW."invoiceId") THEN RAISE EXCEPTION 'INVOICE_ADJUSTMENT_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE CONSTRAINT TRIGGER "CommerceInvoiceVersion_pair" AFTER INSERT ON "CommerceInvoiceVersion" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce_correction_pair();
INSERT INTO "CommercePolicy"(id)VALUES('GLOBAL');

CREATE FUNCTION commerce_subscription_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF TG_OP='DELETE' OR NEW."customerId"<>OLD."customerId" OR NEW.kind<>OLD.kind THEN RAISE EXCEPTION 'NO_SUBSCRIPTION_TRANSFER_OR_ERASURE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER "CommerceSubscription_guard" BEFORE UPDATE OR DELETE ON "CommerceSubscription" FOR EACH ROW EXECUTE FUNCTION commerce_subscription_guard();
CREATE FUNCTION commerce_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF TG_OP='DELETE' OR NEW."customerId"<>OLD."customerId" OR NEW.currency<>OLD.currency OR NEW.number<>OLD.number OR NEW."subscriptionId" IS DISTINCT FROM OLD."subscriptionId" OR (OLD.state='VOIDED' AND NEW.state<>'VOIDED') OR (OLD."issuedAt" IS NOT NULL AND NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt") THEN RAISE EXCEPTION 'IMMUTABLE_INVOICE_IDENTITY' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER "CommerceInvoice_guard" BEFORE UPDATE OR DELETE ON "CommerceInvoice" FOR EACH ROW EXECUTE FUNCTION commerce_invoice_guard();
CREATE FUNCTION commerce_event_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'actorUserId'-'actorAdminId') IS DISTINCT FROM (to_jsonb(OLD)-'actorUserId'-'actorAdminId') OR (NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId" AND NEW."actorUserId" IS NOT NULL) OR (NEW."actorAdminId" IS DISTINCT FROM OLD."actorAdminId" AND NEW."actorAdminId" IS NOT NULL) THEN RAISE EXCEPTION 'IMMUTABLE_COMMERCIAL_EVENT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER "CommerceEvent_guard" BEFORE UPDATE OR DELETE ON "CommerceEvent" FOR EACH ROW EXECUTE FUNCTION commerce_event_guard();
COMMIT;
