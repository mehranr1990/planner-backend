BEGIN;
-- Closing a purchased term is an immutable event, never a rewrite of its dates.
CREATE TABLE "CommerceTermClosure" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "termId" uuid NOT NULL UNIQUE,
 "endedAt" timestamptz(3) NOT NULL,kind varchar(8) NOT NULL CHECK(kind IN ('CHANGE','CANCEL')),
 "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CommerceTermClosure_termId_fk" FOREIGN KEY("termId") REFERENCES "CommerceTerm"(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE TRIGGER "CommerceTermClosure_immutable" BEFORE UPDATE OR DELETE ON "CommerceTermClosure" FOR EACH ROW EXECUTE FUNCTION commerce_immutable();
COMMIT;
