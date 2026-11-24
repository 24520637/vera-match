import { AuthProvider } from "../../../../../src/components/auth/auth-provider";
import { MatchConnectionScreen } from "../../../../../src/components/member/match-connection";
export default function ConnectionFixture() {
  return <AuthProvider><main><MatchConnectionScreen connectionId="synthetic-connection" /></main></AuthProvider>;
}
