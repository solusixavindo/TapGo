INSERT INTO "memberships" ("tier", "name", "price", "direct_bonus", "active_levels")
VALUES
  ('BASIC', 'Basic', 0, 2000, 0),
  ('SILVER', 'Silver', 500000, 0, 10),
  ('GOLD', 'Gold', 3000000, 0, 10),
  ('PLATINUM', 'Platinum', 5500000, 0, 10)
ON CONFLICT ("tier") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "price" = EXCLUDED."price",
  "direct_bonus" = EXCLUDED."direct_bonus",
  "active_levels" = EXCLUDED."active_levels",
  "updated_at" = CURRENT_TIMESTAMP;

DELETE FROM "membership_benefits";

INSERT INTO "membership_benefits" ("membership_id", "level", "commission_rate", "fixed_bonus")
SELECT "id", level, rate, 0
FROM "memberships"
JOIN (
  VALUES
    ('SILVER'::"MembershipTier", 1, 8.00), ('SILVER'::"MembershipTier", 2, 4.00), ('SILVER'::"MembershipTier", 3, 2.00),
    ('SILVER'::"MembershipTier", 4, 2.00), ('SILVER'::"MembershipTier", 5, 2.00), ('SILVER'::"MembershipTier", 6, 1.00),
    ('SILVER'::"MembershipTier", 7, 1.00), ('SILVER'::"MembershipTier", 8, 1.00), ('SILVER'::"MembershipTier", 9, 1.00),
    ('SILVER'::"MembershipTier", 10, 1.00),
    ('GOLD'::"MembershipTier", 1, 8.00), ('GOLD'::"MembershipTier", 2, 4.00), ('GOLD'::"MembershipTier", 3, 2.00),
    ('GOLD'::"MembershipTier", 4, 2.00), ('GOLD'::"MembershipTier", 5, 2.00), ('GOLD'::"MembershipTier", 6, 1.00),
    ('GOLD'::"MembershipTier", 7, 1.00), ('GOLD'::"MembershipTier", 8, 1.00), ('GOLD'::"MembershipTier", 9, 1.00),
    ('GOLD'::"MembershipTier", 10, 1.00),
    ('PLATINUM'::"MembershipTier", 1, 8.00), ('PLATINUM'::"MembershipTier", 2, 4.00), ('PLATINUM'::"MembershipTier", 3, 2.00),
    ('PLATINUM'::"MembershipTier", 4, 2.00), ('PLATINUM'::"MembershipTier", 5, 2.00), ('PLATINUM'::"MembershipTier", 6, 1.00),
    ('PLATINUM'::"MembershipTier", 7, 1.00), ('PLATINUM'::"MembershipTier", 8, 1.00), ('PLATINUM'::"MembershipTier", 9, 1.00),
    ('PLATINUM'::"MembershipTier", 10, 1.00)
) AS benefits(tier, level, rate)
ON "memberships"."tier" = benefits.tier;
