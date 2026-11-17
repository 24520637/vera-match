export const reportReasons = {
  HARASSMENT: "Harassment",
  INAPPROPRIATE_CONTENT: "Inappropriate content",
  IMPERSONATION: "Impersonation",
  SPAM: "Spam",
  OTHER: "Other concern",
} as const;
export const reportStatuses = {
  OPEN: "Open",
  IN_REVIEW: "In review",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
} as const;
export type ReportState = keyof typeof reportStatuses;
export type QueueReport = {
  id: string;
  reasonCode: keyof typeof reportReasons | null;
  status: ReportState;
  revision: number;
  createdAt: string;
};
export type ReportDetail = {
  id: string;
  reason: keyof typeof reportReasons | null;
  details: string;
  status: ReportState;
  revision: number;
  createdAt: string;
  reporterReference: string | null;
  targetReference: string | null;
  actions: {
    revision: number;
    fromStatus: ReportState;
    toStatus: ReportState;
    createdAt: string;
  }[];
};
export const safetyMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The request could not be confirmed. Your entries have been kept.";
export const validReference = (value: string) =>
  /^[A-Za-z0-9_-]{1,200}$/.test(value);
