BEGIN;
-- Precise append-only pause adjustments preserve the original purchased terms.
CREATE TABLE "CommerceTermShift" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "termId" uuid NOT NULL,
 "startShiftMs" bigint NOT NULL DEFAULT 0,
 "endShiftMs" bigint NOT NULL,
 "sourceKey" varchar(160) NOT NULL UNIQUE,
 "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CommerceTermShift_termId_fk" FOREIGN KEY ("termId") REFERENCES "CommerceTerm"(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CommerceTermShift_positive" CHECK ("startShiftMs">=0 AND "endShiftMs">=0 AND "endShiftMs">="startShiftMs")
);
CREATE TRIGGER "CommerceTermShift_immutable" BEFORE UPDATE OR DELETE ON "CommerceTermShift" FOR EACH ROW EXECUTE FUNCTION commerce_immutable();
COMMIT;
