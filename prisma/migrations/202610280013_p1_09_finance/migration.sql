-- AlterTable
ALTER TABLE "CaptureItem" ADD COLUMN     "targetTransactionId" UUID;

-- CreateTable
CREATE TABLE "FinancialAccount" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "scale" INTEGER NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FinancialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceCategory" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FinanceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "type" VARCHAR(12) NOT NULL,
    "effect" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "state" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "localDate" DATE NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "note" VARCHAR(4000),
    "originalId" UUID,
    "replacesId" UUID,
    "sourceCaptureId" UUID,
    "billId" UUID,
    "occurrenceKey" VARCHAR(10),

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionPosting" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "scale" INTEGER NOT NULL,
    "amount" DECIMAL(28,4) NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "categoryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRateSnapshot" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "sourceCurrency" VARCHAR(3) NOT NULL,
    "destinationCurrency" VARCHAR(3) NOT NULL,
    "rate" DECIMAL(30,12) NOT NULL,
    "conversionDate" DATE NOT NULL,
    "rounding" VARCHAR(10) NOT NULL DEFAULT 'HALF_UP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRateSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "scale" INTEGER NOT NULL,
    "limit" DECIMAL(28,4) NOT NULL,
    "categoryId" UUID,
    "period" VARCHAR(10) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "calendar" VARCHAR(10) NOT NULL,
    "firstDayOfWeek" INTEGER NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetPeriod" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "budgetId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "calendar" VARCHAR(10) NOT NULL,
    "firstDayOfWeek" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "scale" INTEGER NOT NULL,
    "limit" DECIMAL(28,4) NOT NULL,
    "categoryId" UUID,

    CONSTRAINT "BudgetPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "logicalId" UUID NOT NULL,
    "rootId" UUID,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATE NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "accountId" UUID NOT NULL,
    "categoryId" UUID,
    "type" VARCHAR(10) NOT NULL,
    "amount" DECIMAL(28,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "scale" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "schedule" JSONB,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsGoal" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "logicalId" UUID NOT NULL,
    "rootId" UUID,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "name" VARCHAR(300) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "scale" INTEGER NOT NULL,
    "target" DECIMAL(28,4) NOT NULL,
    "mode" VARCHAR(10) NOT NULL,
    "accountId" UUID,
    "manualAmount" DECIMAL(28,4),
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SavingsGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialAccount_spaceId_createdAt_id_idx" ON "FinancialAccount"("spaceId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialAccount_spaceId_id_key" ON "FinancialAccount"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialAccount_spaceId_id_currency_scale_key" ON "FinancialAccount"("spaceId", "id", "currency", "scale");

-- CreateIndex
CREATE INDEX "FinanceCategory_spaceId_createdAt_id_idx" ON "FinanceCategory"("spaceId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceCategory_spaceId_id_key" ON "FinanceCategory"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_originalId_key" ON "Transaction"("originalId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_replacesId_key" ON "Transaction"("replacesId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_sourceCaptureId_key" ON "Transaction"("sourceCaptureId");

-- CreateIndex
CREATE INDEX "Transaction_spaceId_occurredAt_id_idx" ON "Transaction"("spaceId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "Transaction_spaceId_createdAt_id_idx" ON "Transaction"("spaceId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_spaceId_id_key" ON "Transaction"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_billId_occurrenceKey_key" ON "Transaction"("billId", "occurrenceKey");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_spaceId_originalId_key" ON "Transaction"("spaceId", "originalId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_spaceId_replacesId_key" ON "Transaction"("spaceId", "replacesId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_spaceId_sourceCaptureId_key" ON "Transaction"("spaceId", "sourceCaptureId");

-- CreateIndex
CREATE INDEX "TransactionPosting_spaceId_accountId_transactionId_idx" ON "TransactionPosting"("spaceId", "accountId", "transactionId");

-- CreateIndex
CREATE INDEX "TransactionPosting_spaceId_categoryId_transactionId_idx" ON "TransactionPosting"("spaceId", "categoryId", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionPosting_spaceId_id_key" ON "TransactionPosting"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionPosting_transactionId_role_key" ON "TransactionPosting"("transactionId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRateSnapshot_transactionId_key" ON "ExchangeRateSnapshot"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRateSnapshot_spaceId_id_key" ON "ExchangeRateSnapshot"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRateSnapshot_spaceId_transactionId_key" ON "ExchangeRateSnapshot"("spaceId", "transactionId");

-- CreateIndex
CREATE INDEX "Budget_spaceId_createdAt_id_idx" ON "Budget"("spaceId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_spaceId_id_key" ON "Budget"("spaceId", "id");

-- CreateIndex
CREATE INDEX "BudgetPeriod_spaceId_createdAt_id_idx" ON "BudgetPeriod"("spaceId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetPeriod_spaceId_id_key" ON "BudgetPeriod"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetPeriod_budgetId_startDate_key" ON "BudgetPeriod"("budgetId", "startDate");

-- CreateIndex
CREATE INDEX "Bill_spaceId_current_createdAt_logicalId_idx" ON "Bill"("spaceId", "current", "createdAt", "logicalId");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_spaceId_id_key" ON "Bill"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_logicalId_revision_key" ON "Bill"("logicalId", "revision");

-- CreateIndex
CREATE INDEX "SavingsGoal_spaceId_current_createdAt_logicalId_idx" ON "SavingsGoal"("spaceId", "current", "createdAt", "logicalId");

-- CreateIndex
CREATE UNIQUE INDEX "SavingsGoal_spaceId_id_key" ON "SavingsGoal"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SavingsGoal_logicalId_revision_key" ON "SavingsGoal"("logicalId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureItem_targetTransactionId_key" ON "CaptureItem"("targetTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureItem_spaceId_targetTransactionId_key" ON "CaptureItem"("spaceId", "targetTransactionId");

-- AddForeignKey
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_spaceId_targetTransactionId_fkey" FOREIGN KEY ("spaceId", "targetTransactionId") REFERENCES "Transaction"("spaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCategory" ADD CONSTRAINT "FinanceCategory_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_spaceId_originalId_fkey" FOREIGN KEY ("spaceId", "originalId") REFERENCES "Transaction"("spaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_spaceId_replacesId_fkey" FOREIGN KEY ("spaceId", "replacesId") REFERENCES "Transaction"("spaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_spaceId_sourceCaptureId_fkey" FOREIGN KEY ("spaceId", "sourceCaptureId") REFERENCES "CaptureItem"("spaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_spaceId_billId_fkey" FOREIGN KEY ("spaceId", "billId") REFERENCES "Bill"("spaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionPosting" ADD CONSTRAINT "TransactionPosting_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionPosting" ADD CONSTRAINT "TransactionPosting_spaceId_transactionId_fkey" FOREIGN KEY ("spaceId", "transactionId") REFERENCES "Transaction"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionPosting" ADD CONSTRAINT "TransactionPosting_spaceId_accountId_currency_scale_fkey" FOREIGN KEY ("spaceId", "accountId", "currency", "scale") REFERENCES "FinancialAccount"("spaceId", "id", "currency", "scale") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionPosting" ADD CONSTRAINT "TransactionPosting_spaceId_categoryId_fkey" FOREIGN KEY ("spaceId", "categoryId") REFERENCES "FinanceCategory"("spaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRateSnapshot" ADD CONSTRAINT "ExchangeRateSnapshot_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRateSnapshot" ADD CONSTRAINT "ExchangeRateSnapshot_spaceId_transactionId_fkey" FOREIGN KEY ("spaceId", "transactionId") REFERENCES "Transaction"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_spaceId_categoryId_fkey" FOREIGN KEY ("spaceId", "categoryId") REFERENCES "FinanceCategory"("spaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetPeriod" ADD CONSTRAINT "BudgetPeriod_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetPeriod" ADD CONSTRAINT "BudgetPeriod_spaceId_budgetId_fkey" FOREIGN KEY ("spaceId", "budgetId") REFERENCES "Budget"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetPeriod" ADD CONSTRAINT "BudgetPeriod_spaceId_categoryId_fkey" FOREIGN KEY ("spaceId", "categoryId") REFERENCES "FinanceCategory"("spaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_spaceId_rootId_fkey" FOREIGN KEY ("spaceId", "rootId") REFERENCES "Bill"("spaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_spaceId_accountId_currency_scale_fkey" FOREIGN KEY ("spaceId", "accountId", "currency", "scale") REFERENCES "FinancialAccount"("spaceId", "id", "currency", "scale") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_spaceId_categoryId_fkey" FOREIGN KEY ("spaceId", "categoryId") REFERENCES "FinanceCategory"("spaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_spaceId_rootId_fkey" FOREIGN KEY ("spaceId", "rootId") REFERENCES "SavingsGoal"("spaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_spaceId_accountId_currency_scale_fkey" FOREIGN KEY ("spaceId", "accountId", "currency", "scale") REFERENCES "FinancialAccount"("spaceId", "id", "currency", "scale") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_currency_scale" CHECK ((currency,scale) IN (('AFN',2),('EUR',2),('ALL',2),('DZD',2),('USD',2),('AOA',2),('XCD',2),('XAD',2),('ARS',2),('AMD',2),('AWG',2),('AUD',2),('AZN',2),('BSD',2),('BHD',3),('BDT',2),('BBD',2),('BYN',2),('BZD',2),('XOF',0),('BMD',2),('INR',2),('BTN',2),('BOB',2),('BOV',2),('BAM',2),('BWP',2),('NOK',2),('BRL',2),('BND',2),('BIF',0),('CVE',2),('KHR',2),('XAF',0),('CAD',2),('KYD',2),('CLP',0),('CLF',4),('CNY',2),('COP',2),('COU',2),('KMF',0),('CDF',2),('NZD',2),('CRC',2),('CUP',2),('XCG',2),('CZK',2),('DKK',2),('DJF',0),('DOP',2),('EGP',2),('SVC',2),('ERN',2),('SZL',2),('ETB',2),('FKP',2),('FJD',2),('XPF',0),('GMD',2),('GEL',2),('GHS',2),('GIP',2),('GTQ',2),('GBP',2),('GNF',0),('GYD',2),('HTG',2),('HNL',2),('HKD',2),('HUF',2),('ISK',0),('IDR',2),('IRR',2),('IQD',3),('ILS',2),('JMD',2),('JPY',0),('JOD',3),('KZT',2),('KES',2),('KPW',2),('KRW',0),('KWD',3),('KGS',2),('LAK',2),('LBP',2),('LSL',2),('ZAR',2),('LRD',2),('LYD',3),('CHF',2),('MOP',2),('MKD',2),('MGA',2),('MWK',2),('MYR',2),('MVR',2),('MRU',2),('MUR',2),('MXN',2),('MXV',2),('MDL',2),('MNT',2),('MAD',2),('MZN',2),('MMK',2),('NAD',2),('NPR',2),('NIO',2),('NGN',2),('OMR',3),('PKR',2),('PAB',2),('PGK',2),('PYG',0),('PEN',2),('PHP',2),('PLN',2),('QAR',2),('RON',2),('RUB',2),('RWF',0),('SHP',2),('WST',2),('STN',2),('SAR',2),('RSD',2),('SCR',2),('SLE',2),('SGD',2),('SBD',2),('SOS',2),('SSP',2),('LKR',2),('SDG',2),('SRD',2),('SEK',2),('CHE',2),('CHW',2),('SYP',2),('TWD',2),('TJS',2),('TZS',2),('THB',2),('TOP',2),('TTD',2),('TND',3),('TRY',2),('TMT',2),('UGX',0),('UAH',2),('AED',2),('USN',2),('UYU',2),('UYI',0),('UYW',4),('UZS',2),('VUV',0),('VES',2),('VED',2),('VND',0),('YER',2),('ZMW',2),('ZWG',2)));

ALTER TABLE "Budget" ADD CONSTRAINT "Budget_currency_scale" CHECK ((currency,scale) IN (('AFN',2),('EUR',2),('ALL',2),('DZD',2),('USD',2),('AOA',2),('XCD',2),('XAD',2),('ARS',2),('AMD',2),('AWG',2),('AUD',2),('AZN',2),('BSD',2),('BHD',3),('BDT',2),('BBD',2),('BYN',2),('BZD',2),('XOF',0),('BMD',2),('INR',2),('BTN',2),('BOB',2),('BOV',2),('BAM',2),('BWP',2),('NOK',2),('BRL',2),('BND',2),('BIF',0),('CVE',2),('KHR',2),('XAF',0),('CAD',2),('KYD',2),('CLP',0),('CLF',4),('CNY',2),('COP',2),('COU',2),('KMF',0),('CDF',2),('NZD',2),('CRC',2),('CUP',2),('XCG',2),('CZK',2),('DKK',2),('DJF',0),('DOP',2),('EGP',2),('SVC',2),('ERN',2),('SZL',2),('ETB',2),('FKP',2),('FJD',2),('XPF',0),('GMD',2),('GEL',2),('GHS',2),('GIP',2),('GTQ',2),('GBP',2),('GNF',0),('GYD',2),('HTG',2),('HNL',2),('HKD',2),('HUF',2),('ISK',0),('IDR',2),('IRR',2),('IQD',3),('ILS',2),('JMD',2),('JPY',0),('JOD',3),('KZT',2),('KES',2),('KPW',2),('KRW',0),('KWD',3),('KGS',2),('LAK',2),('LBP',2),('LSL',2),('ZAR',2),('LRD',2),('LYD',3),('CHF',2),('MOP',2),('MKD',2),('MGA',2),('MWK',2),('MYR',2),('MVR',2),('MRU',2),('MUR',2),('MXN',2),('MXV',2),('MDL',2),('MNT',2),('MAD',2),('MZN',2),('MMK',2),('NAD',2),('NPR',2),('NIO',2),('NGN',2),('OMR',3),('PKR',2),('PAB',2),('PGK',2),('PYG',0),('PEN',2),('PHP',2),('PLN',2),('QAR',2),('RON',2),('RUB',2),('RWF',0),('SHP',2),('WST',2),('STN',2),('SAR',2),('RSD',2),('SCR',2),('SLE',2),('SGD',2),('SBD',2),('SOS',2),('SSP',2),('LKR',2),('SDG',2),('SRD',2),('SEK',2),('CHE',2),('CHW',2),('SYP',2),('TWD',2),('TJS',2),('TZS',2),('THB',2),('TOP',2),('TTD',2),('TND',3),('TRY',2),('TMT',2),('UGX',0),('UAH',2),('AED',2),('USN',2),('UYU',2),('UYI',0),('UYW',4),('UZS',2),('VUV',0),('VES',2),('VED',2),('VND',0),('YER',2),('ZMW',2),('ZWG',2)));

ALTER TABLE "BudgetPeriod" ADD CONSTRAINT "BudgetPeriod_currency_scale" CHECK ((currency,scale) IN (('AFN',2),('EUR',2),('ALL',2),('DZD',2),('USD',2),('AOA',2),('XCD',2),('XAD',2),('ARS',2),('AMD',2),('AWG',2),('AUD',2),('AZN',2),('BSD',2),('BHD',3),('BDT',2),('BBD',2),('BYN',2),('BZD',2),('XOF',0),('BMD',2),('INR',2),('BTN',2),('BOB',2),('BOV',2),('BAM',2),('BWP',2),('NOK',2),('BRL',2),('BND',2),('BIF',0),('CVE',2),('KHR',2),('XAF',0),('CAD',2),('KYD',2),('CLP',0),('CLF',4),('CNY',2),('COP',2),('COU',2),('KMF',0),('CDF',2),('NZD',2),('CRC',2),('CUP',2),('XCG',2),('CZK',2),('DKK',2),('DJF',0),('DOP',2),('EGP',2),('SVC',2),('ERN',2),('SZL',2),('ETB',2),('FKP',2),('FJD',2),('XPF',0),('GMD',2),('GEL',2),('GHS',2),('GIP',2),('GTQ',2),('GBP',2),('GNF',0),('GYD',2),('HTG',2),('HNL',2),('HKD',2),('HUF',2),('ISK',0),('IDR',2),('IRR',2),('IQD',3),('ILS',2),('JMD',2),('JPY',0),('JOD',3),('KZT',2),('KES',2),('KPW',2),('KRW',0),('KWD',3),('KGS',2),('LAK',2),('LBP',2),('LSL',2),('ZAR',2),('LRD',2),('LYD',3),('CHF',2),('MOP',2),('MKD',2),('MGA',2),('MWK',2),('MYR',2),('MVR',2),('MRU',2),('MUR',2),('MXN',2),('MXV',2),('MDL',2),('MNT',2),('MAD',2),('MZN',2),('MMK',2),('NAD',2),('NPR',2),('NIO',2),('NGN',2),('OMR',3),('PKR',2),('PAB',2),('PGK',2),('PYG',0),('PEN',2),('PHP',2),('PLN',2),('QAR',2),('RON',2),('RUB',2),('RWF',0),('SHP',2),('WST',2),('STN',2),('SAR',2),('RSD',2),('SCR',2),('SLE',2),('SGD',2),('SBD',2),('SOS',2),('SSP',2),('LKR',2),('SDG',2),('SRD',2),('SEK',2),('CHE',2),('CHW',2),('SYP',2),('TWD',2),('TJS',2),('TZS',2),('THB',2),('TOP',2),('TTD',2),('TND',3),('TRY',2),('TMT',2),('UGX',0),('UAH',2),('AED',2),('USN',2),('UYU',2),('UYI',0),('UYW',4),('UZS',2),('VUV',0),('VES',2),('VED',2),('VND',0),('YER',2),('ZMW',2),('ZWG',2)));

ALTER TABLE "Bill" ADD CONSTRAINT "Bill_currency_scale" CHECK ((currency,scale) IN (('AFN',2),('EUR',2),('ALL',2),('DZD',2),('USD',2),('AOA',2),('XCD',2),('XAD',2),('ARS',2),('AMD',2),('AWG',2),('AUD',2),('AZN',2),('BSD',2),('BHD',3),('BDT',2),('BBD',2),('BYN',2),('BZD',2),('XOF',0),('BMD',2),('INR',2),('BTN',2),('BOB',2),('BOV',2),('BAM',2),('BWP',2),('NOK',2),('BRL',2),('BND',2),('BIF',0),('CVE',2),('KHR',2),('XAF',0),('CAD',2),('KYD',2),('CLP',0),('CLF',4),('CNY',2),('COP',2),('COU',2),('KMF',0),('CDF',2),('NZD',2),('CRC',2),('CUP',2),('XCG',2),('CZK',2),('DKK',2),('DJF',0),('DOP',2),('EGP',2),('SVC',2),('ERN',2),('SZL',2),('ETB',2),('FKP',2),('FJD',2),('XPF',0),('GMD',2),('GEL',2),('GHS',2),('GIP',2),('GTQ',2),('GBP',2),('GNF',0),('GYD',2),('HTG',2),('HNL',2),('HKD',2),('HUF',2),('ISK',0),('IDR',2),('IRR',2),('IQD',3),('ILS',2),('JMD',2),('JPY',0),('JOD',3),('KZT',2),('KES',2),('KPW',2),('KRW',0),('KWD',3),('KGS',2),('LAK',2),('LBP',2),('LSL',2),('ZAR',2),('LRD',2),('LYD',3),('CHF',2),('MOP',2),('MKD',2),('MGA',2),('MWK',2),('MYR',2),('MVR',2),('MRU',2),('MUR',2),('MXN',2),('MXV',2),('MDL',2),('MNT',2),('MAD',2),('MZN',2),('MMK',2),('NAD',2),('NPR',2),('NIO',2),('NGN',2),('OMR',3),('PKR',2),('PAB',2),('PGK',2),('PYG',0),('PEN',2),('PHP',2),('PLN',2),('QAR',2),('RON',2),('RUB',2),('RWF',0),('SHP',2),('WST',2),('STN',2),('SAR',2),('RSD',2),('SCR',2),('SLE',2),('SGD',2),('SBD',2),('SOS',2),('SSP',2),('LKR',2),('SDG',2),('SRD',2),('SEK',2),('CHE',2),('CHW',2),('SYP',2),('TWD',2),('TJS',2),('TZS',2),('THB',2),('TOP',2),('TTD',2),('TND',3),('TRY',2),('TMT',2),('UGX',0),('UAH',2),('AED',2),('USN',2),('UYU',2),('UYI',0),('UYW',4),('UZS',2),('VUV',0),('VES',2),('VED',2),('VND',0),('YER',2),('ZMW',2),('ZWG',2)));

ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_currency_scale" CHECK ((currency,scale) IN (('AFN',2),('EUR',2),('ALL',2),('DZD',2),('USD',2),('AOA',2),('XCD',2),('XAD',2),('ARS',2),('AMD',2),('AWG',2),('AUD',2),('AZN',2),('BSD',2),('BHD',3),('BDT',2),('BBD',2),('BYN',2),('BZD',2),('XOF',0),('BMD',2),('INR',2),('BTN',2),('BOB',2),('BOV',2),('BAM',2),('BWP',2),('NOK',2),('BRL',2),('BND',2),('BIF',0),('CVE',2),('KHR',2),('XAF',0),('CAD',2),('KYD',2),('CLP',0),('CLF',4),('CNY',2),('COP',2),('COU',2),('KMF',0),('CDF',2),('NZD',2),('CRC',2),('CUP',2),('XCG',2),('CZK',2),('DKK',2),('DJF',0),('DOP',2),('EGP',2),('SVC',2),('ERN',2),('SZL',2),('ETB',2),('FKP',2),('FJD',2),('XPF',0),('GMD',2),('GEL',2),('GHS',2),('GIP',2),('GTQ',2),('GBP',2),('GNF',0),('GYD',2),('HTG',2),('HNL',2),('HKD',2),('HUF',2),('ISK',0),('IDR',2),('IRR',2),('IQD',3),('ILS',2),('JMD',2),('JPY',0),('JOD',3),('KZT',2),('KES',2),('KPW',2),('KRW',0),('KWD',3),('KGS',2),('LAK',2),('LBP',2),('LSL',2),('ZAR',2),('LRD',2),('LYD',3),('CHF',2),('MOP',2),('MKD',2),('MGA',2),('MWK',2),('MYR',2),('MVR',2),('MRU',2),('MUR',2),('MXN',2),('MXV',2),('MDL',2),('MNT',2),('MAD',2),('MZN',2),('MMK',2),('NAD',2),('NPR',2),('NIO',2),('NGN',2),('OMR',3),('PKR',2),('PAB',2),('PGK',2),('PYG',0),('PEN',2),('PHP',2),('PLN',2),('QAR',2),('RON',2),('RUB',2),('RWF',0),('SHP',2),('WST',2),('STN',2),('SAR',2),('RSD',2),('SCR',2),('SLE',2),('SGD',2),('SBD',2),('SOS',2),('SSP',2),('LKR',2),('SDG',2),('SRD',2),('SEK',2),('CHE',2),('CHW',2),('SYP',2),('TWD',2),('TJS',2),('TZS',2),('THB',2),('TOP',2),('TTD',2),('TND',3),('TRY',2),('TMT',2),('UGX',0),('UAH',2),('AED',2),('USN',2),('UYU',2),('UYI',0),('UYW',4),('UZS',2),('VUV',0),('VES',2),('VED',2),('VND',0),('YER',2),('ZMW',2),('ZWG',2)));

ALTER TABLE "TransactionPosting" ADD CONSTRAINT "TransactionPosting_currency_scale" CHECK ((currency,scale) IN (('AFN',2),('EUR',2),('ALL',2),('DZD',2),('USD',2),('AOA',2),('XCD',2),('XAD',2),('ARS',2),('AMD',2),('AWG',2),('AUD',2),('AZN',2),('BSD',2),('BHD',3),('BDT',2),('BBD',2),('BYN',2),('BZD',2),('XOF',0),('BMD',2),('INR',2),('BTN',2),('BOB',2),('BOV',2),('BAM',2),('BWP',2),('NOK',2),('BRL',2),('BND',2),('BIF',0),('CVE',2),('KHR',2),('XAF',0),('CAD',2),('KYD',2),('CLP',0),('CLF',4),('CNY',2),('COP',2),('COU',2),('KMF',0),('CDF',2),('NZD',2),('CRC',2),('CUP',2),('XCG',2),('CZK',2),('DKK',2),('DJF',0),('DOP',2),('EGP',2),('SVC',2),('ERN',2),('SZL',2),('ETB',2),('FKP',2),('FJD',2),('XPF',0),('GMD',2),('GEL',2),('GHS',2),('GIP',2),('GTQ',2),('GBP',2),('GNF',0),('GYD',2),('HTG',2),('HNL',2),('HKD',2),('HUF',2),('ISK',0),('IDR',2),('IRR',2),('IQD',3),('ILS',2),('JMD',2),('JPY',0),('JOD',3),('KZT',2),('KES',2),('KPW',2),('KRW',0),('KWD',3),('KGS',2),('LAK',2),('LBP',2),('LSL',2),('ZAR',2),('LRD',2),('LYD',3),('CHF',2),('MOP',2),('MKD',2),('MGA',2),('MWK',2),('MYR',2),('MVR',2),('MRU',2),('MUR',2),('MXN',2),('MXV',2),('MDL',2),('MNT',2),('MAD',2),('MZN',2),('MMK',2),('NAD',2),('NPR',2),('NIO',2),('NGN',2),('OMR',3),('PKR',2),('PAB',2),('PGK',2),('PYG',0),('PEN',2),('PHP',2),('PLN',2),('QAR',2),('RON',2),('RUB',2),('RWF',0),('SHP',2),('WST',2),('STN',2),('SAR',2),('RSD',2),('SCR',2),('SLE',2),('SGD',2),('SBD',2),('SOS',2),('SSP',2),('LKR',2),('SDG',2),('SRD',2),('SEK',2),('CHE',2),('CHW',2),('SYP',2),('TWD',2),('TJS',2),('TZS',2),('THB',2),('TOP',2),('TTD',2),('TND',3),('TRY',2),('TMT',2),('UGX',0),('UAH',2),('AED',2),('USN',2),('UYU',2),('UYI',0),('UYW',4),('UZS',2),('VUV',0),('VES',2),('VED',2),('VND',0),('YER',2),('ZMW',2),('ZWG',2)));
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_revision" CHECK (revision>0);
ALTER TABLE "FinanceCategory" ADD CONSTRAINT "FinanceCategory_revision" CHECK (revision>0);
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_revision" CHECK (revision>0);
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_revision" CHECK (revision>0);
ALTER TABLE "BudgetPeriod" ADD CONSTRAINT "BudgetPeriod_revision" CHECK (revision>0);
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_revision" CHECK (revision>0);
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_revision" CHECK (revision>0);

ALTER TABLE "FinanceCategory" ADD CONSTRAINT "FinanceCategory_values" CHECK (kind IN ('INCOME','EXPENSE') AND position BETWEEN 0 AND 9999);
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_values" CHECK (type IN ('INCOME','EXPENSE','TRANSFER','ADJUSTMENT') AND effect IN ('POSTED','REVERSAL') AND state IN ('POSTED','REVERSED') AND ((effect='POSTED' AND "originalId" IS NULL) OR (effect='REVERSAL' AND "originalId" IS NOT NULL AND state='POSTED' AND "replacesId" IS NULL AND "sourceCaptureId" IS NULL AND "billId" IS NULL)) AND "originalId" IS DISTINCT FROM id AND "replacesId" IS DISTINCT FROM id AND (("billId" IS NULL)=("occurrenceKey" IS NULL)) AND ("sourceCaptureId" IS NULL OR type='EXPENSE'));
ALTER TABLE "TransactionPosting" ADD CONSTRAINT "TransactionPosting_values" CHECK (amount<>0 AND amount=trunc(amount,scale) AND role IN ('INCOME','EXPENSE','TRANSFER_OUT','TRANSFER_IN','ADJUSTMENT','FEE'));
ALTER TABLE "ExchangeRateSnapshot" ADD CONSTRAINT "ExchangeRateSnapshot_values" CHECK (rate>0 AND "sourceCurrency"<>"destinationCurrency" AND rounding='HALF_UP');
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_values" CHECK ("limit">0 AND "limit"=trunc("limit",scale) AND period IN ('WEEKLY','MONTHLY','CUSTOM') AND calendar IN ('GREGORIAN','JALALI') AND "firstDayOfWeek" BETWEEN 0 AND 6);
ALTER TABLE "BudgetPeriod" ADD CONSTRAINT "BudgetPeriod_values" CHECK ("limit">0 AND "limit"=trunc("limit",scale) AND "endDate">"startDate" AND "endAt">="startAt" AND calendar IN ('GREGORIAN','JALALI') AND "firstDayOfWeek" BETWEEN 0 AND 6);
CREATE UNIQUE INDEX "Bill_current_logical" ON "Bill" ("logicalId") WHERE current;
CREATE UNIQUE INDEX "SavingsGoal_current_logical" ON "SavingsGoal" ("logicalId") WHERE current;
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_identity" CHECK ((revision=1 AND id="logicalId" AND "rootId" IS NULL) OR (revision>1 AND id<>"logicalId" AND "rootId"="logicalId"));
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_identity" CHECK ((revision=1 AND id="logicalId" AND "rootId" IS NULL) OR (revision>1 AND id<>"logicalId" AND "rootId"="logicalId"));
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_values" CHECK (type IN ('INCOME','EXPENSE') AND amount>0 AND amount=trunc(amount,scale));
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_values" CHECK (target>0 AND target=trunc(target,scale) AND ((mode='ACCOUNT' AND "accountId" IS NOT NULL AND "manualAmount" IS NULL) OR (mode='MANUAL' AND "accountId" IS NULL AND "manualAmount" IS NOT NULL AND "manualAmount">=0 AND "manualAmount"=trunc("manualAmount",scale))));
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_finance_type" CHECK ("targetTransactionId" IS NULL OR type='EXPENSE');
