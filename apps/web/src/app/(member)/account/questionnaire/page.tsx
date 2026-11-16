import { MemberSettings } from "@/components/member/member-settings";
export const metadata = { title: "Your questionnaire", robots: { index: false } };
export default function QuestionnairePage() { return <MemberSettings screen="questionnaire" />; }
