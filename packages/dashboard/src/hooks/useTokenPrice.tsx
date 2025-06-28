import { useEffect, useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";

import { chunks } from "@/lib/utils";

export interface PriceAPIResult {
  data: Record<
    string,
    {
      id: string;
      mintSymbol: string;
      vsToken: string;
      vsTokenSymbol: string;
      price: number;
    }
  >;
}

// Exponential backoff utility function
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithRetry = async (
  url: string,
  maxRetries = 5,
): Promise<Response> => {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);

      // If we get a 429, implement exponential backoff
      if (response.status === 429) {
        if (attempt === maxRetries) {
          throw new Error(`Rate limited after ${maxRetries} retries`);
        }

        // Exponential backoff: 1s, 2s, 4s, 8s, 16s with jitter
        const baseDelay = Math.pow(2, attempt) * 1000;
        const jitter = Math.random() * 0.3 * baseDelay; // Add 0-30% jitter
        const delay = baseDelay + jitter;

        console.log(
          `Rate limited, retrying in ${Math.round(delay)}ms (attempt ${
            attempt + 1
          }/${maxRetries + 1})`,
        );
        await sleep(delay);
        continue;
      }

      // If response is ok or any other error (not 429), return it
      return response;
    } catch (error) {
      // If it's the last attempt or not a network error, throw
      if (attempt === maxRetries || !(error instanceof TypeError)) {
        throw error;
      }

      // Network error, retry with backoff
      const baseDelay = Math.pow(2, attempt) * 1000;
      const jitter = Math.random() * 0.3 * baseDelay;
      const delay = baseDelay + jitter;

      console.log(
        `Network error, retrying in ${Math.round(delay)}ms (attempt ${
          attempt + 1
        }/${maxRetries + 1})`,
      );
      await sleep(delay);
    }
  }

  throw new Error(`Failed after ${maxRetries} retries`);
};

export const TOKEN_PRICES_KEY = "token-prices";
export const useFetchTokenPrices = (tokenMints: string[]) => {
  return useQueries({
    queries: chunks(tokenMints, 10).map((tokens, index) => {
      // console.log({ tokens });
      return {
        queryKey: [TOKEN_PRICES_KEY, ...tokens],
        queryFn: async () => {
          // Add a small delay between chunks to avoid overwhelming the API
          if (index > 0) {
            await sleep(index * 1000); // 1000ms delay per chunk
          }

          const response = await fetchWithRetry(
            `https://jupiter-swap-api.quiknode.pro/86224A516F95/price?ids=${tokens.join(
              ",",
            )}`,
          );

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const data: PriceAPIResult = await response.json();
          // console.log({ data: data.data });

          // Transform the response to use mint addresses as keys instead of token symbols
          const transformedData: PriceAPIResult["data"] = {};
          Object.values(data.data).forEach((tokenData) => {
            transformedData[tokenData.id] = tokenData;
          });

          return transformedData;
        },
        // Add retry configuration for react-query level retries
        retry: (failureCount: number, error: unknown) => {
          // Don't retry 429s at react-query level since we handle them in fetchWithRetry
          if (
            error instanceof Error &&
            error.message.includes("Rate limited")
          ) {
            return false;
          }
          // Retry other errors up to 3 times
          return failureCount < 3;
        },
        retryDelay: (attemptIndex: number) =>
          Math.min(1000 * 2 ** attemptIndex, 30000),
        // Consider data stale after 5 minutes
        staleTime: 5 * 60 * 1000,
        // Cache for 10 minutes
        gcTime: 10 * 60 * 1000,
      };
    }),
  });
};

export const useGetTokenPrice = (mint: string) => {
  const [_, rerender] = useState<{}>();
  const queryClient = useQueryClient();

  useEffect(() => {
    const queryCache = queryClient.getQueryCache();

    const unsubscribe = queryCache.subscribe((event) => {
      if (!event) {
        return;
      }

      const {
        query: { queryKey },
      } = event;

      if (queryKey[0] === TOKEN_PRICES_KEY && queryKey.includes(mint)) {
        rerender({});
      }
    });

    return unsubscribe;
  }, [queryClient, mint]);

  const price = useMemo(() => {
    // Find any cached query data that contains this mint
    const allQueries = queryClient.getQueryCache().findAll([TOKEN_PRICES_KEY]);
    const relevantQuery = allQueries.find((query) =>
      query.queryKey.includes(mint),
    );

    const prices = relevantQuery?.state.data as
      | PriceAPIResult["data"]
      | undefined;
    return prices?.[mint]?.price;
  }, [queryClient, mint, _]);

  return price;
};

export const useGetTokenPrices = (mints: string[]) => {
  const [_, rerender] = useState<{}>();
  const queryClient = useQueryClient();

  useEffect(() => {
    const queryCache = queryClient.getQueryCache();

    const unsubscribe = queryCache.subscribe((event) => {
      if (!event) {
        return;
      }

      const {
        query: { queryKey },
      } = event;

      if (
        queryKey[0] === TOKEN_PRICES_KEY &&
        queryKey.some((key: string) => mints.includes(key))
      ) {
        rerender({});
      }
    });

    return unsubscribe;
  }, [queryClient, mints]);

  const pricesHash = useMemo(() => {
    return mints.reduce((acc, mint) => {
      // Find any cached query data that contains this mint
      const allQueries = queryClient
        .getQueryCache()
        .findAll([TOKEN_PRICES_KEY]);
      const relevantQuery = allQueries.find((query) =>
        query.queryKey.includes(mint),
      );

      const prices = relevantQuery?.state.data as
        | PriceAPIResult["data"]
        | undefined;
      return { ...acc, ...(prices || {}) };
    }, {} as PriceAPIResult["data"]);
  }, [queryClient, mints]);

  return pricesHash;
};
