import type { ReactNode } from "react";
import ProtectedLayout from "../(protected)/layout";
import { MemberDrafts } from "@/components/member/member-drafts";

export default function MemberLayout({ children }: { children: ReactNode }) {
  return <MemberDrafts><ProtectedLayout>{children}</ProtectedLayout></MemberDrafts>;
}
