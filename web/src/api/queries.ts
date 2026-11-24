// TanStack's useQueries with api/query.ts's check, apart from it: only the chat's composer uses it,
// and its code stays out of the first screen.
import { useQueries as useQueriesOf, type QueryClient } from "@tanstack/react-query";
import { useLook, type Asked } from "./query";

export const useQueries = ((options: { queries: readonly Asked[] }, client?: QueryClient) => {
  useLook(() => [...options.queries], client);
  return useQueriesOf(options as never, client);
}) as typeof useQueriesOf;
