import {
  GetSessionDetailsError,
  GetSessionDetailsResponse,
  ReleaseBrowserSessionResponse,
  ReleaseBrowserSessionsError,
} from "@/steel-client";
import { ReactNode } from "react";
import { UseMutationResult, UseQueryResult } from "@tanstack/react-query";

export type SessionsContextType = {
  useReleaseSessionMutation: () => UseMutationResult<
    ReleaseBrowserSessionResponse,
    ReleaseBrowserSessionsError,
    string,
    unknown
  >;
  useSession: (
    id: string
  ) => UseQueryResult<GetSessionDetailsResponse | null, GetSessionDetailsError>;
};

export type SessionsProviderProps = {
  children: ReactNode;
};
