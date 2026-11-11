# Reciprocal matching — transparent and consent-aware

## Candidate eligibility and scoring

1. Consider only `ACTIVE` accounts with verified email, a declared adult-age requirement, and current profile-matching consent.
2. Apply **two-way hard constraints**: preferred age range, required relationship goals, mutual blocks, profile visibility, and explicit dealbreakers.
3. Compute separate directional compatibility scores, `S(A→B)` and `S(B→A)`, from user-provided goals, values, lifestyle, and interests. Initial weights are product heuristics, not validated predictors of romantic outcomes.
4. A cautious aggregate example is `min(S(A→B), S(B→A))`, ensuring a strong preference from one user does not override the other's constraints. Never label `88%` a probability of relationship success.
5. Only factual video-content claims are eligible after **independent QA approval + individual member confirmation + explicit share approval + no revocation + current applicable consent**.
6. **Never** score Big Five impressions, perceived honesty/loyalty, inferred morality, facial expression, eye direction, or other subjective unvalidated personality attributes.
7. Generate explanations only from fields the member has permitted to share. Never disclose private reports or raw expert observations.
8. Support authenticated `ACCEPT`/`DECLINE` decisions from both sides; create a mutual connection only when both accept. Blocking or consent withdrawal must remove or invalidate ineligible recommendations promptly.

## Essential tests

- A satisfies B's conditions, but B does not satisfy A's → reject the pair.
- A block from either direction → no recommendation.
- A revoked claim, revoked matching consent, or not-yet-approved review → exclude that information immediately.
- Stable pair identity prevents `A,B` and `B,A` duplicates; directional scores may still differ.
- Explanations reveal no private personal data or unpublished reviewer notes.
