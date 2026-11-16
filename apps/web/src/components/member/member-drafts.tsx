"use client";
import { createContext, ReactNode, useContext, useRef } from "react";
import { Values } from "@/lib/member-contracts";
import { useAuth } from "../auth/auth-provider";

type Draft = { values: Values; dirty: string[] };
type Store = { read: (screen: string) => Draft | undefined; write: (screen: string, draft: Draft) => void };
const Context = createContext<Store | undefined>(undefined);

/** Memory only; survives a child session boundary, never a logout or member switch. */
export function MemberDrafts({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const memory = useRef({ owner: "", drafts: new Map<string, Draft>() });
  const owner = state.status === "authenticated" && state.user.role === "MEMBER" ? state.user.id : undefined;
  if ((state.status === "authenticated" && (owner ?? "") !== memory.current.owner) || state.status === "unauthenticated" || state.status === "forbidden") {
    memory.current = { owner: owner ?? "", drafts: new Map() };
  }
  const current = memory.current;
  return <Context.Provider value={{
    read: screen => owner && current.owner === owner ? current.drafts.get(screen) : undefined,
    write: (screen, draft) => {
      // Late results from an unmounted editor cannot write into another identity's store.
      if (owner && memory.current === current && current.owner === owner) {
        if (draft.dirty.length) current.drafts.set(screen, draft);
        else current.drafts.delete(screen);
      }
    },
  }}>{children}</Context.Provider>;
}
export function useMemberDrafts() { return useContext(Context); }
