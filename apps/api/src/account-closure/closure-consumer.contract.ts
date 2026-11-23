/** Integration contract only; no consumer is acknowledged by defining this type. */
export const closureConsumers = ["MEDIA", "REVIEW_CLAIMS", "MATCHING", "SAFETY", "RECOVERY"] as const;
export type ClosureConsumer = typeof closureConsumers[number];
export interface ClosureReconciliationV1 {
  contractVersion: 1;
  closureId: string;
  expectedClosureRevision: number;
  consumer: ClosureConsumer;
}
/** The consumer must persist and verify its own minimal receipt in the same
 * transaction as its domain reconciliation. This is not a public ACK endpoint.
 * The foundation deliberately leaves every closure consumer PENDING. */
export type ClosureReconciliationResult =
  | { status: "PENDING"; code: "DEPENDENCY_PENDING" | "PROVIDER_UNCONFIRMED" | "RETENTION_REVIEW_REQUIRED" }
  | { status: "VERIFIED"; receiptId: string; verifiedAt: Date };
