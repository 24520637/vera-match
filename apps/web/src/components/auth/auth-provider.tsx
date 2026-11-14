"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { AuthState, AuthUser, isAuthUser } from "@/lib/auth-types";

type AuthContextValue = {
  state: AuthState;
  refresh: () => Promise<void>;
  acceptUser: (user: AuthUser) => void;
  clearUser: () => void;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: "checking",
    user: null,
  });
  const sequence = useRef(0);
  const request = useRef<AbortController | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState((previous) =>
      previous.status === "authenticated" ||
      previous.status === "unauthenticated"
        ? previous
        : { status: "checking", user: null },
    );
    try {
      const user = await apiRequest<unknown>("/auth/me", {
        signal: controller.signal,
      });
      if (!isAuthUser(user)) throw new Error("Invalid current-user response");
      if (current === sequence.current)
        setState({ status: "authenticated", user });
    } catch (error) {
      if (controller.signal.aborted || current !== sequence.current) return;
      const status =
        error instanceof ApiError && error.status === 401
          ? "unauthenticated"
          : error instanceof ApiError && error.status === 403
            ? "forbidden"
            : "unavailable";
      setState({ status, user: null });
    }
  }, []);
  const acceptUser = useCallback((user: AuthUser) => {
    ++sequence.current;
    request.current?.abort();
    setState({ status: "authenticated", user });
    channel.current?.postMessage("changed");
  }, []);
  const clearUser = useCallback(() => {
    ++sequence.current;
    request.current?.abort();
    setState({ status: "unauthenticated", user: null });
    channel.current?.postMessage("changed");
  }, []);
  useEffect(() => {
    void refresh();
    const recheck = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", recheck);
    window.addEventListener("online", recheck);
    window.addEventListener("pageshow", recheck);
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("vera-auth");
      channel.current.onmessage = () => void refresh();
    }
    return () => {
      ++sequence.current;
      request.current?.abort();
      window.removeEventListener("focus", recheck);
      window.removeEventListener("online", recheck);
      window.removeEventListener("pageshow", recheck);
      channel.current?.close();
      channel.current = null;
    };
  }, [refresh]);
  return (
    <AuthContext.Provider value={{ state, refresh, acceptUser, clearUser }}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is required");
  return context;
}
