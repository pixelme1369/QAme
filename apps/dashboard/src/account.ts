import { createContext, useContext } from "react";

/** Currently selected account (client) id, empty until accounts load. */
export const AccountContext = createContext<string>("");

export function useAccountId(): string {
  return useContext(AccountContext);
}
