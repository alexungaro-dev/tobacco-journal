import { createContext, useContext, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "./useAuth";
const Context = createContext<ReturnType<typeof useAuth> | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const auth = useAuth(i18n.resolvedLanguage || "it");
  return <Context.Provider value={auth}>{children}</Context.Provider>;
}
export function useAuthContext() {
  const value = useContext(Context);
  if (!value) throw new Error("AuthProvider missing");
  return value;
}
