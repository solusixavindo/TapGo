import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const requiredFiles = [
  "README.md",
  "infra/docker-compose.yml",
  "docs/architecture/SYSTEM_ARCHITECTURE.md",
  "docs/architecture/DATABASE_DESIGN.md",
  "docs/architecture/FOLDER_STRUCTURE.md",
  "apps/backend/package.json",
  "apps/backend/src/app.ts",
  "apps/backend/src/server.ts",
  "apps/backend/prisma/schema.prisma",
  "apps/backend/prisma/migrations/0001_init/migration.sql",
  "apps/backend/prisma/seed.ts",
  "apps/backend/src/modules/auth/application/AuthService.ts",
  "apps/backend/src/modules/auth/presentation/auth.routes.ts",
  "apps/backend/src/modules/memberships/domain/MembershipRepository.ts",
  "apps/backend/src/modules/memberships/application/MembershipService.ts",
  "apps/backend/src/modules/memberships/infrastructure/PrismaMembershipRepository.ts",
  "apps/backend/src/modules/memberships/presentation/membership.controller.ts",
  "apps/backend/src/modules/memberships/presentation/membership.routes.ts",
  "apps/backend/src/modules/memberships/presentation/membership.validators.ts",
  "apps/backend/src/modules/referrals/application/ReferralService.ts",
  "apps/backend/src/modules/referrals/application/CommissionEngine.ts",
  "apps/backend/src/modules/referrals/infrastructure/PrismaReferralRepository.ts",
  "apps/backend/src/modules/referrals/presentation/referral.routes.ts",
  "apps/backend/src/modules/wallets/domain/WalletRepository.ts",
  "apps/backend/src/modules/wallets/application/WalletService.ts",
  "apps/backend/src/modules/wallets/infrastructure/PrismaWalletRepository.ts",
  "apps/backend/src/modules/wallets/presentation/wallet.routes.ts",
  "apps/backend/prisma/migrations/0002_referral_membership/migration.sql",
  "apps/backend/prisma/migrations/0003_referral_wallet_hardening/migration.sql",
  "apps/backend/prisma/migrations/0004_tapgo_business_rules/migration.sql",
  "apps/backend/prisma/migrations/0005_tapgo_package_seed/migration.sql",
  "apps/backend/vitest.config.ts",
  "apps/backend/tests/helpers/referralWalletHarness.ts",
  "apps/backend/tests/referrals/commissionEngine.test.ts",
  "apps/backend/tests/referrals/referralWallet.integration.test.ts",
  "docs/referral/COMMISSION_ENGINE.md",
  "docs/referral/WALLET_SYSTEM.md",
  "docs/referral/MEMBERSHIP_SYSTEM.md",
  "apps/user_app/pubspec.yaml",
  "apps/user_app/lib/main.dart",
  "apps/driver_app/pubspec.yaml",
  "apps/driver_app/lib/main.dart",
  "apps/admin_dashboard/package.json",
  "apps/admin_dashboard/src/app/layout.tsx",
  "apps/admin_dashboard/src/app/globals.css",
  "apps/admin_dashboard/src/app/page.tsx",
  "packages/shared/src/index.ts"
];

await Promise.all(requiredFiles.map((file) => access(file, constants.R_OK)));

const prisma = await readFile("apps/backend/prisma/schema.prisma", "utf8");
const authRoutes = await readFile("apps/backend/src/modules/auth/presentation/auth.routes.ts", "utf8");
const membershipRoutes = await readFile("apps/backend/src/modules/memberships/presentation/membership.routes.ts", "utf8");
const referralRoutes = await readFile("apps/backend/src/modules/referrals/presentation/referral.routes.ts", "utf8");
const walletRoutes = await readFile("apps/backend/src/modules/wallets/presentation/wallet.routes.ts", "utf8");

const checks = [
  [prisma.includes("model User"), "Prisma schema must define User"],
  [prisma.includes("model Driver"), "Prisma schema must define Driver"],
  [prisma.includes("model Ride"), "Prisma schema must define Ride"],
  [prisma.includes("model WalletTransaction"), "Prisma schema must define wallet ledger"],
  [prisma.includes("model Membership"), "Prisma schema must define Membership"],
  [prisma.includes("model Referral"), "Prisma schema must define Referral"],
  [prisma.includes("model ReferralLevel"), "Prisma schema must define ReferralLevel"],
  [prisma.includes("model Commission"), "Prisma schema must define Commission"],
  [prisma.includes("model Withdrawal"), "Prisma schema must define Withdrawal"],
  [authRoutes.includes('"/register"'), "Auth routes must expose register"],
  [authRoutes.includes('"/login"'), "Auth routes must expose login"],
  [authRoutes.includes('"/refresh"'), "Auth routes must expose refresh"],
  [membershipRoutes.includes('"/plans"'), "Membership routes must expose plans"],
  [membershipRoutes.includes('"/me"'), "Membership routes must expose me"],
  [membershipRoutes.includes('"/upgrade"'), "Membership routes must expose upgrade"],
  [membershipRoutes.includes('"/admin/plans/:tier"'), "Membership routes must expose admin rules update"],
  [referralRoutes.includes('"/claim"'), "Referral routes must expose claim"],
  [referralRoutes.includes('"/summary"'), "Referral routes must expose summary"],
  [referralRoutes.includes('"/tree"'), "Referral routes must expose tree"],
  [referralRoutes.includes('"/uplink"'), "Referral routes must expose uplink"],
  [referralRoutes.includes('"/downlines"'), "Referral routes must expose downlines"],
  [referralRoutes.includes('"/depth"'), "Referral routes must expose depth"],
  [referralRoutes.includes('"/commissions"'), "Referral routes must expose commissions"]
  ,
  [walletRoutes.includes('"/transactions"'), "Wallet routes must expose transaction history"],
  [walletRoutes.includes('"/withdrawals"'), "Wallet routes must expose withdrawal request"],
  [walletRoutes.includes('"/admin/users/:userId"'), "Wallet routes must expose admin wallet monitoring"],
  [walletRoutes.includes('"/admin/withdrawals"'), "Wallet routes must expose admin withdrawals"],
  [walletRoutes.includes('"/admin/withdrawals/:withdrawalId/approve"'), "Wallet routes must expose admin approve"],
  [walletRoutes.includes('"/admin/withdrawals/:withdrawalId/reject"'), "Wallet routes must expose admin reject"],
  [walletRoutes.includes('"/admin/withdrawals/:withdrawalId/paid"'), "Wallet routes must expose admin paid"]
];

const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("TapGo structure validation passed.");
