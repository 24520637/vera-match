import type { Metadata } from "next";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { ClosureStatus } from "@/components/privacy/closure-status";
export const metadata: Metadata = {title:"Closure progress",robots:{index:false,follow:false},referrer:"no-referrer"};
export default function Page(){return <AuthScaffold title="Closure progress." description="Use your verified email to check an account closure request."><ClosureStatus /></AuthScaffold>;}
