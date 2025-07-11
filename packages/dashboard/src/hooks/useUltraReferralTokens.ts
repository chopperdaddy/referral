import { ReferralProvider } from "@jup-ag/referral-sdk";
import { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";

export const useUltraReferralTokens = (
  referralProvider: ReferralProvider,
  referralPubkey: PublicKey | string,
) =>
  useQuery({
    queryKey: ["tokens", referralPubkey.toString()],
    queryFn: () => {
      return referralProvider.getReferralTokenAccountsWithStrategyV2(
        referralPubkey.toString(),
        { type: "token-list" },
      );
    },
  });
