import type { AuthUser } from "./auth-types";

type StaffRole = Exclude<AuthUser["role"], "MEMBER">;

export const staffWorkspaces: Record<StaffRole, {
  title: string;
  description: string;
  links: { href: string; label: string }[];
}> = {
  EXPERT: {
    title: "Your review work",
    description: "Open an assignment to watch its video and prepare your review. Verify staff access before reviewing.",
    links: [{ href: "/expert/assignments", label: "My assignments" }],
  },
  MODERATOR: {
    title: "Your moderation work",
    description: "Assign videos, review submitted assessments and handle reports. Verify staff access before continuing.",
    links: [
      { href: "/moderation/assignments", label: "Video assignments" },
      { href: "/qa/reviews", label: "Review QA" },
      { href: "/moderation/reports", label: "Report queue" },
    ],
  },
  ADMIN: {
    title: "Your administration tools",
    description: "Manage assignment grants through the API documentation. Grant administration requires verified staff access and the assignment grant permission.",
    links: [{ href: "/api/docs", label: "API documentation" }],
  },
};
