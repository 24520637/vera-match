import type { Metadata } from "next";
import { AccountClosure } from "@/components/privacy/account-closure";
export const metadata: Metadata = {title:"Close your account",robots:{index:false,follow:false},referrer:"no-referrer"};
export default function Page(){return <AccountClosure />;}
