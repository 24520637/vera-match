# Trust, safety and account privacy

## Scope and status

Huong / T11. This independently testable deliverable implements member blocking,
bounded reporting and a moderator-only workflow. It does not implement matching,
expert assignment/review access, account closure, hard deletion or retention policy.
C062 matching/review integration and C065 remain explicit dependencies; C066
account-deletion controls must not imply an unavailable service.

## C061 persistence

Existing Block/Report/AuditLog models are reused. Directional blocks reference real
users, remain unique and reject self-blocks. Reports gain a nullable technical
reason catalog and independent bounded revision; existing free text is preserved
without inventing a historical classification. Reporter/target/moderator mappings
use SET NULL so future account removal cannot cascade report evidence away.
Moderator transitions retain separate append-only actions and opaque actor evidence;
recording times are database-owned. Safety-prefixed AuditLog rows cannot be edited
or deleted, and AuditLog truncation is denied. These integrity constraints do not
approve indefinite retention or add a privileged purge procedure.

The additive migration validates existing foreign keys/self-reference constraints.
It fails atomically on inconsistent legacy rows rather than dropping/repairing them.
Review orphan/self-reference records before deployment. Apply only through the
normal reviewed migration process; local public database migration is NOT performed.
Tests use synthetic UUID-owned schemas and test initial-schema upgrades.
