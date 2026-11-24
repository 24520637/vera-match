"use client";
import { AuthProvider } from "../../../../../src/components/auth/auth-provider";
import { AccountOverview } from "../../../../../src/components/auth/account-overview";
import { SiteHeader } from "../../../../../src/components/layout/site-header";

export default function AccountOverviewFixture() {
  return <AuthProvider><SiteHeader /><main><AccountOverview /></main></AuthProvider>;
}
