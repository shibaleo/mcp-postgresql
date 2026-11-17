"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { takeLoginError } from "@/lib/session-client";
import { LoginPage } from "./login-page";

export interface MeUser {
  id: string;
  name: string;
  email: string;
}

interface UserContextValue {
  me: MeUser;
  refresh: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | null>(null);

export function useMe(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useMe must be used within AuthGate");
  return ctx;
}

type AuthState = "loading" | "authenticated" | "unauthenticated";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");
  const [me, setMe] = useState<MeUser | null>(null);
  const [error] = useState<string | null>(() => takeLoginError());

  const fetchMe = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/v1/me");
      if (res.ok) {
        const json = (await res.json()) as { data: MeUser };
        setMe(json.data);
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }, []);

  // セッションは HttpOnly の cookie（src/lib/session.ts）。/me が通るかだけを見る
  useEffect(() => {
    fetchMe().then((ok) => setState(ok ? "authenticated" : "unauthenticated"));
  }, [fetchMe]);

  if (state === "loading" || (state === "authenticated" && !me)) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (state === "unauthenticated" || !me) {
    return <LoginPage error={error} />;
  }

  return (
    <UserContext.Provider
      value={{
        me,
        refresh: async () => {
          await fetchMe();
        },
      }}
    >
      {children}
    </UserContext.Provider>
  );
}
