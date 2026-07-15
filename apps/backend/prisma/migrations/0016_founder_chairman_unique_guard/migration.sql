-- Enforce that Founder Chairman can only be granted once.
CREATE UNIQUE INDEX IF NOT EXISTS "founder_program_grants_one_chairman_key"
  ON "founder_program_grants" ("founder_role")
  WHERE "founder_role" = 'FOUNDER_CHAIRMAN'::"FounderRole";
