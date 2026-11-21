import { AuthProvider } from "../../../../../src/components/auth/auth-provider";
import { MemberMatches } from "../../../../../src/components/member/member-matches";

export default function MatchingFixture() {
  return <AuthProvider><main><MemberMatches /></main></AuthProvider>;
}
