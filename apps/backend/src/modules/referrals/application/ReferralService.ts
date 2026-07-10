import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { CreateReferralInput, ReferralRepository } from "../domain/ReferralRepository.js";

const MAX_REFERRAL_LEVEL = 10;

export class ReferralService {
  constructor(private readonly repository: ReferralRepository) {}

  async claimReferral(input: CreateReferralInput) {
    return this.repository.transaction(async (tx) => {
      const user = await this.repository.findUserById(input.userId, tx);
      if (!user) {
        throw new AppError("User not found", StatusCodes.NOT_FOUND, "USER_NOT_FOUND");
      }

      const sponsor = await this.repository.findUserByReferralCode(input.sponsorCode, tx);
      if (!sponsor) {
        throw new AppError("Sponsor referral code is invalid", StatusCodes.BAD_REQUEST, "SPONSOR_NOT_FOUND");
      }

      if (sponsor.id === user.id) {
        throw new AppError("Self referral is not allowed", StatusCodes.BAD_REQUEST, "SELF_REFERRAL_BLOCKED");
      }

      const existingReferral = await this.repository.findExistingReferral(user.id, tx);
      if (existingReferral) {
        throw new AppError("Referral has already been claimed", StatusCodes.CONFLICT, "REFERRAL_ALREADY_CLAIMED");
      }

      const wouldCreateCycle = await this.repository.hasReferralPath(user.id, sponsor.id, tx);
      if (wouldCreateCycle) {
        throw new AppError("Circular referral is not allowed", StatusCodes.BAD_REQUEST, "CIRCULAR_REFERRAL_BLOCKED");
      }

      const referral = await this.repository.createReferral(
        {
          sponsorId: sponsor.id,
          userId: user.id
        },
        tx
      );

      const sponsorAncestors = await this.repository.getSponsorAncestors(sponsor.id, tx);
      const referralLevelRows = [
        { ancestorId: sponsor.id, descendantId: user.id, level: 1 },
        ...sponsorAncestors
          .filter((ancestor) => ancestor.level + 1 <= MAX_REFERRAL_LEVEL)
          .map((ancestor) => ({
            ancestorId: ancestor.ancestorId,
            descendantId: user.id,
            level: ancestor.level + 1
          }))
      ];

      await this.repository.createReferralLevels(referralLevelRows, tx);

      return referral;
    });
  }

  getSummary(userId: string) {
    return this.repository.getSummary(userId);
  }

  getTree(userId: string, maxLevel: number) {
    return this.repository.getTree(userId, Math.min(maxLevel, MAX_REFERRAL_LEVEL));
  }

  getUplinkChain(userId: string, maxLevel: number) {
    return this.repository.getUplinkChain(userId, Math.min(maxLevel, MAX_REFERRAL_LEVEL));
  }

  getDownlines(userId: string, maxLevel: number, page: number, pageSize: number) {
    return this.repository.getDownlinesRecursive(
      userId,
      Math.min(maxLevel, MAX_REFERRAL_LEVEL),
      page,
      Math.min(pageSize, 100)
    );
  }

  getDepthStats(userId: string, maxLevel: number) {
    return this.repository.getDepthStats(userId, Math.min(maxLevel, MAX_REFERRAL_LEVEL));
  }

  getCommissions(userId: string, page: number, pageSize: number) {
    return this.repository.getCommissions(userId, page, Math.min(pageSize, 100));
  }

}
