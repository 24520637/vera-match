import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { StaffSecurity } from "@/components/staff/staff-security";
export const metadata: Metadata = {title:"Staff security | VERA Match",robots:{index:false,follow:false},referrer:"no-referrer"};
export default function Page(){return <div className="container auth-shell"><div className="auth-context"><h1>Keep your staff access private.</h1><p className="lede">Confirm it is you before working with sensitive reports and reviews.</p><p className="small muted">Authenticator verification is short-lived. Your assigned permissions still apply.</p></div><Card className="auth-panel"><StaffSecurity/></Card></div>;}
