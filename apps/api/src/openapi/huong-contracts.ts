import { staffMfaContracts } from "./staff-mfa";
import type { OpenAPIObject, SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";

export type Contract = { method: "get" | "post" | "patch" | "delete"; path: string; summary: string; status: number; response?: SchemaObject; body?: SchemaObject; security: boolean; description: string };
// Synthetic schemas only. Never populate documentation from live database records.
export const huongContracts: Contract[] = [
  {
    "method": "post",
    "path": "/api/auth/register",
    "summary": "Request registration and email activation",
    "status": 202,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "message": {
          "type": "string"
        }
      },
      "required": [
        "message"
      ]
    },
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "email": {
          "type": "string",
          "format": "email",
          "maxLength": 254
        },
        "password": {
          "type": "string",
          "minLength": 12,
          "maxLength": 128,
          "writeOnly": true
        },
        "declaredAdult": {
          "type": "boolean",
          "enum": [
            true
          ]
        },
        "displayName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80
        }
      },
      "required": [
        "email",
        "password",
        "declaredAdult"
      ]
    },
    "security": false,
    "description": "Generic acknowledgement does not disclose whether an email exists. Registration never starts an active session."
  },
  {
    "method": "post",
    "path": "/api/auth/login",
    "summary": "Create an HttpOnly browser session",
    "status": 200,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string"
        },
        "email": {
          "type": "string",
          "format": "email",
          "maxLength": 254
        },
        "displayName": {
          "type": "string",
          "nullable": true
        },
        "role": {
          "type": "string",
          "enum": [
            "MEMBER",
            "EXPERT",
            "MODERATOR",
            "ADMIN"
          ]
        }
      },
      "required": [
        "id",
        "email",
        "displayName",
        "role"
      ]
    },
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "email": {
          "type": "string",
          "format": "email",
          "maxLength": 254
        },
        "password": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128,
          "writeOnly": true
        }
      },
      "required": [
        "email",
        "password"
      ]
    },
    "security": false,
    "description": "Sets the deployment-configured HttpOnly cookie. Pending, suspended, closed and unverified accounts cannot sign in. No bearer token is returned."
  },
  {
    "method": "get",
    "path": "/api/auth/me",
    "summary": "Restore the current authenticated user",
    "status": 200,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string"
        },
        "email": {
          "type": "string",
          "format": "email",
          "maxLength": 254
        },
        "displayName": {
          "type": "string",
          "nullable": true
        },
        "role": {
          "type": "string",
          "enum": [
            "MEMBER",
            "EXPERT",
            "MODERATOR",
            "ADMIN"
          ]
        }
      },
      "required": [
        "id",
        "email",
        "displayName",
        "role"
      ]
    },
    "security": true,
    "description": ""
  },
  {
    "method": "post",
    "path": "/api/auth/logout",
    "summary": "Revoke the current session and clear its cookie",
    "status": 204,
    "security": false,
    "description": "Idempotent. Does not require a valid existing session.",
    "body": {
      "type": "object",
      "additionalProperties": false
    }
  },
  {
    "method": "post",
    "path": "/api/auth/logout-all",
    "summary": "Revoke all sessions for the authenticated account",
    "status": 204,
    "security": true,
    "description": "",
    "body": {
      "type": "object",
      "additionalProperties": false
    }
  },
  {
    "method": "post",
    "path": "/api/auth/verify-email",
    "summary": "Consume a single-use activation token",
    "status": 200,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "message": {
          "type": "string"
        }
      },
      "required": [
        "message"
      ]
    },
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "token": {
          "type": "string",
          "pattern": "^[A-Za-z0-9_-]{43}$",
          "writeOnly": true
        }
      },
      "required": [
        "token"
      ]
    },
    "security": false,
    "description": ""
  },
  {
    "method": "post",
    "path": "/api/auth/resend-verification",
    "summary": "Request another activation email",
    "status": 202,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "message": {
          "type": "string"
        },
        "retryAfterSeconds": {
          "type": "integer"
        }
      },
      "required": [
        "message",
        "retryAfterSeconds"
      ]
    },
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "email": {
          "type": "string",
          "format": "email",
          "maxLength": 254
        }
      },
      "required": [
        "email"
      ]
    },
    "security": false,
    "description": "Generic response; cooldown does not prove email delivery."
  },
  {
    "method": "post",
    "path": "/api/auth/forgot-password",
    "summary": "Request a password recovery email",
    "status": 202,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "message": {
          "type": "string"
        }
      },
      "required": [
        "message"
      ]
    },
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "email": {
          "type": "string",
          "format": "email",
          "maxLength": 254
        }
      },
      "required": [
        "email"
      ]
    },
    "security": false,
    "description": "Generic response for eligible and ineligible addresses; no account enumeration or delivery guarantee."
  },
  {
    "method": "post",
    "path": "/api/auth/reset-password",
    "summary": "Consume a reset token and revoke all existing sessions",
    "status": 200,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "message": {
          "type": "string"
        }
      },
      "required": [
        "message"
      ]
    },
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "token": {
          "type": "string",
          "pattern": "^[A-Za-z0-9_-]{43}$",
          "writeOnly": true
        },
        "newPassword": {
          "type": "string",
          "minLength": 12,
          "maxLength": 128,
          "writeOnly": true
        }
      },
      "required": [
        "token",
        "newPassword"
      ]
    },
    "security": false,
    "description": "Does not activate an account or automatically sign in."
  },
  {
    "method": "post",
    "path": "/api/videos/upload-intent",
    "summary": "Issue a private owner upload intent",
    "status": 201,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string"
        },
        "status": {
          "type": "string"
        },
        "uploadUrl": {
          "type": "string",
          "format": "uri"
        },
        "expiresAt": {
          "type": "string",
          "format": "date-time"
        },
        "headers": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "Content-Type": {
              "type": "string"
            }
          },
          "required": [
            "Content-Type"
          ]
        }
      },
      "required": [
        "id",
        "status",
        "uploadUrl",
        "expiresAt",
        "headers"
      ]
    },
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "mimeType": {
          "type": "string",
          "enum": [
            "video/mp4",
            "video/webm"
          ]
        },
        "sizeBytes": {
          "type": "integer",
          "minimum": 12,
          "maximum": 104857600
        }
      },
      "required": [
        "mimeType",
        "sizeBytes"
      ]
    },
    "security": true,
    "description": "MEMBER owner with current VIDEO_STORAGE consent. PUT bytes directly to the returned private storage capability using the returned Content-Type. Capability expires after 300 seconds. Never log the signed URL."
  },
  {
    "method": "get",
    "path": "/api/videos/me",
    "summary": "List owner videos with cursor pagination",
    "status": 200,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "videos": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "id": {
                "type": "string"
              },
              "status": {
                "type": "string"
              },
              "mimeType": {
                "type": "string"
              },
              "sizeBytes": {
                "type": "integer",
                "nullable": true
              },
              "createdAt": {
                "type": "string",
                "format": "date-time"
              },
              "deletedAt": {
                "type": "string",
                "format": "date-time",
                "nullable": true
              },
              "cleanupCompletedAt": {
                "type": "string",
                "format": "date-time",
                "nullable": true
              }
            },
            "required": [
              "id",
              "status",
              "mimeType",
              "sizeBytes",
              "createdAt",
              "deletedAt",
              "cleanupCompletedAt"
            ]
          }
        },
        "nextCursor": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "videos",
        "nextCursor"
      ]
    },
    "security": true,
    "description": "Returns at most 50 videos. Use nextCursor verbatim; metadata never grants playback."
  },
  {
    "method": "post",
    "path": "/api/videos/{id}/confirm",
    "summary": "Verify and confirm an owner upload",
    "status": 201,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "READY"
          ]
        }
      },
      "required": [
        "id",
        "status"
      ]
    },
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {},
      "required": []
    },
    "security": true,
    "description": "Verifies storage object MIME, size and container, and promotes to an immutable playback key. READY confirms storage, not necessarily a verified duration for review observations."
  },
  {
    "method": "post",
    "path": "/api/videos/{id}/playback",
    "summary": "Issue an owner-only private playback URL",
    "status": 201,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string"
        },
        "url": {
          "type": "string",
          "format": "uri"
        },
        "expiresAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "url",
        "expiresAt"
      ]
    },
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {},
      "required": []
    },
    "security": true,
    "description": "MEMBER owner only; current storage consent and original generation binding are required. URL TTL is 60 seconds; previously issued URLs may remain valid until expiry. Experts use the assignment endpoint instead."
  },
  {
    "method": "delete",
    "path": "/api/videos/{id}",
    "summary": "Tombstone an owner video and enqueue verified cleanup",
    "status": 202,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "DELETED"
          ]
        },
        "cleanup": {
          "type": "string",
          "enum": [
            "PENDING"
          ]
        }
      },
      "required": [
        "id",
        "status",
        "cleanup"
      ]
    },
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {},
      "required": []
    },
    "security": true,
    "description": "Does not require current storage consent. Denies new access and cancels eligible assignments atomically. PENDING is not physical erasure."
  },
  {
    "method": "get",
    "path": "/api/blocks/me",
    "summary": "List blocks created by the current member",
    "status": 200,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "blocks": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "targetUserId": {
                "type": "string"
              },
              "createdAt": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "targetUserId",
              "createdAt"
            ]
          }
        },
        "nextCursor": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "blocks",
        "nextCursor"
      ]
    },
    "security": true,
    "description": ""
  },
  {
    "method": "post",
    "path": "/api/blocks",
    "summary": "Idempotently block another member",
    "status": 204,
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "targetUserId": {
          "type": "string"
        }
      },
      "required": [
        "targetUserId"
      ]
    },
    "security": true,
    "description": "MEMBER only. Bilateral access restrictions apply; does not fabricate assignment cancellation."
  },
  {
    "method": "delete",
    "path": "/api/blocks/{targetUserId}",
    "summary": "Idempotently remove only the caller-owned block",
    "status": 204,
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {},
      "required": []
    },
    "security": true,
    "description": "Unblocking does not revive invalidated matching decisions or stale handles."
  },
  {
    "method": "post",
    "path": "/api/reports",
    "summary": "Submit a private member report request",
    "status": 202,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "message": {
          "type": "string"
        }
      },
      "required": [
        "message"
      ]
    },
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "targetUserId": {
          "type": "string"
        },
        "reason": {
          "type": "string",
          "enum": [
            "HARASSMENT",
            "INAPPROPRIATE_CONTENT",
            "IMPERSONATION",
            "SPAM",
            "OTHER"
          ]
        },
        "details": {
          "type": "string",
          "minLength": 10,
          "maxLength": 2000
        }
      },
      "required": [
        "targetUserId",
        "reason",
        "details"
      ]
    },
    "security": true,
    "description": "Generic acknowledgement for eligible, absent or unavailable targets. Never include passwords, session tokens or private signed URLs. Reason enum is verified against Prisma in regression tests."
  },
  {
    "method": "get",
    "path": "/api/moderation/reports",
    "summary": "Read the authorized moderator report queue",
    "status": 200,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "reports": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "id": {
                "type": "string"
              },
              "reasonCode": {
                "type": "string",
                "nullable": true
              },
              "status": {
                "type": "string"
              },
              "createdAt": {
                "type": "string",
                "format": "date-time"
              },
              "revision": {
                "type": "integer"
              }
            },
            "required": [
              "id",
              "reasonCode",
              "status",
              "createdAt",
              "revision"
            ]
          }
        },
        "nextCursor": {
          "type": "string",
          "nullable": true
        }
      },
      "required": [
        "reports",
        "nextCursor"
      ]
    },
    "security": true,
    "description": "MODERATOR with trusted current MFA assurance only; ADMIN does not inherit this role. Own-party reports excluded. Queue exposes metadata, not report text. Production assurance remains fail-closed."
  },
  {
    "method": "get",
    "path": "/api/moderation/reports/{id}",
    "summary": "Read a report claimed by the current moderator",
    "status": 200,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "report": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "id": {
              "type": "string"
            },
            "reason": {
              "type": "string",
              "nullable": true
            },
            "details": {
              "type": "string"
            },
            "status": {
              "type": "string"
            },
            "revision": {
              "type": "integer"
            },
            "createdAt": {
              "type": "string",
              "format": "date-time"
            },
            "reporterReference": {
              "type": "string",
              "nullable": true
            },
            "targetReference": {
              "type": "string",
              "nullable": true
            },
            "actions": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "revision": {
                    "type": "integer"
                  },
                  "fromStatus": {
                    "type": "string"
                  },
                  "toStatus": {
                    "type": "string"
                  },
                  "createdAt": {
                    "type": "string",
                    "format": "date-time"
                  }
                },
                "required": [
                  "revision",
                  "fromStatus",
                  "toStatus",
                  "createdAt"
                ]
              }
            }
          },
          "required": [
            "id",
            "reason",
            "details",
            "status",
            "revision",
            "createdAt",
            "reporterReference",
            "targetReference",
            "actions"
          ]
        }
      },
      "required": [
        "report"
      ]
    },
    "security": true,
    "description": "Trusted moderator assurance and claim ownership required. Private text must not be rendered as HTML or persisted in browser storage."
  },
  {
    "method": "patch",
    "path": "/api/moderation/reports/{id}",
    "summary": "Claim or transition a report with revision CAS",
    "status": 200,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "report": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "id": {
              "type": "string"
            },
            "status": {
              "type": "string"
            },
            "revision": {
              "type": "integer"
            }
          },
          "required": [
            "id",
            "status",
            "revision"
          ]
        }
      },
      "required": [
        "report"
      ]
    },
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "expectedRevision": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "status": {
          "type": "string",
          "enum": [
            "IN_REVIEW",
            "RESOLVED",
            "DISMISSED"
          ]
        }
      },
      "required": [
        "expectedRevision",
        "status"
      ]
    },
    "security": true,
    "description": "OPEN → IN_REVIEW claims an unassigned report. Only its owning moderator may resolve or dismiss IN_REVIEW. No reopen; immutable transition evidence and audit are atomic."
  },
  {
    "method": "get",
    "path": "/api/account-closure/availability",
    "summary": "Check closure release availability",
    "status": 200,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "available": {
          "type": "boolean"
        }
      },
      "required": [
        "available"
      ]
    },
    "security": true,
    "description": "Production currently returns available:false. Does not grant closure permission."
  },
  {
    "method": "post",
    "path": "/api/account-closure",
    "summary": "Accept a freshly authenticated member closure request",
    "status": 202,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "receiptId": {
          "type": "string"
        },
        "state": {
          "type": "string",
          "enum": [
            "RESTRICTED"
          ]
        },
        "revision": {
          "type": "integer"
        },
        "cleanupPending": {
          "type": "boolean"
        }
      },
      "required": [
        "receiptId",
        "state",
        "revision",
        "cleanupPending"
      ]
    },
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "confirmation": {
          "type": "string",
          "enum": [
            "CLOSE MY ACCOUNT"
          ]
        },
        "password": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024,
          "writeOnly": true,
          "description": "Maximum 1024 UTF-8 bytes, not characters."
        },
        "expectedRevision": {
          "type": "integer",
          "enum": [
            0
          ]
        }
      },
      "required": [
        "confirmation",
        "password",
        "expectedRevision"
      ]
    },
    "security": true,
    "description": "Requires UUID Idempotency-Key and fresh current password. Revokes ordinary sessions; 202 never claims final erasure. Production returns 503 CLOSURE_RELEASE_PENDING."
  },
  {
    "method": "post",
    "path": "/api/account-closure/status-email",
    "summary": "Request restricted status email without restoring account access",
    "status": 202,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "message": {
          "type": "string"
        }
      },
      "required": [
        "message"
      ]
    },
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "email": {
          "type": "string",
          "format": "email",
          "maxLength": 254
        }
      },
      "required": [
        "email"
      ]
    },
    "security": false,
    "description": "Generic response; only previously verified email, within 30 days of closure. Production release gate remains closed."
  },
  {
    "method": "post",
    "path": "/api/account-closure/status",
    "summary": "Consume a restricted one-time closure status capability",
    "status": 200,
    "response": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "state": {
          "type": "string",
          "enum": [
            "RESTRICTED"
          ]
        },
        "revision": {
          "type": "integer"
        },
        "cleanupPending": {
          "type": "boolean"
        },
        "retentionPending": {
          "type": "boolean"
        }
      },
      "required": [
        "state",
        "revision",
        "cleanupPending",
        "retentionPending"
      ]
    },
    "body": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "token": {
          "type": "string",
          "pattern": "^[A-Za-z0-9_-]{43}$",
          "writeOnly": true
        }
      },
      "required": [
        "token"
      ]
    },
    "security": false,
    "description": "Hash-only token, single-use, up to 15 minutes. Does not create a normal session or expose identity/media/evidence. Production release gate remains closed."
  }
];

huongContracts.push(
  { method: "get", path: "/api/health", summary: "Check API process liveness", status: 200, response: { type: "object", properties: { service: { type: "string", enum: ["vera-api"] }, status: { type: "string", enum: ["ok"] }, implementation: { type: "string", enum: ["scaffold"] } } }, security: false, description: "Process liveness only. Does not establish database readiness or production release approval." },
  { method: "get", path: "/api/health/ready", summary: "Check PostgreSQL readiness", status: 200, response: { type: "object", properties: { service: { type: "string", enum: ["vera-api"] }, status: { type: "string", enum: ["ready"] }, database: { type: "string", enum: ["ok"] } } }, security: false, description: "Returns 503 DATABASE_UNAVAILABLE when the database probe fails. No credentials or error payload are returned." },
);

huongContracts.push(...staffMfaContracts);

export function addHuongContracts(document: OpenAPIObject) {
  const errorSchema: SchemaObject = { type: "object", properties: { code: { type: "string" }, message: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] }, statusCode: { type: "integer" }, details: { type: "array", items: { type: "object" } }, retryAfterSeconds: { type: "integer", minimum: 1 } } };
  for (const contract of huongContracts) {
    const operation = document.paths[contract.path]?.[contract.method];
    if (!operation) continue; // Small health-only test applications need not register domain controllers.
    operation.summary = contract.summary;
    operation.description = contract.description + (contract.method === "get" ? "" : " Browser requests must use the configured Origin; send application/json when a JSON body is defined. Do not persist sensitive request/response data in Swagger UI.");
    operation.tags = [contract.path.split("/")[2]];
    operation.security = contract.security ? [{ sessionCookie: [] }] : [];
    operation.responses = { [contract.status]: { description: contract.status === 204 ? "Successful request. No response body." : "Successful request.", ...(contract.response ? { content: { "application/json": { schema: contract.response } } } : {}) } };
    if (contract.path.startsWith("/api/health")) {
      if (contract.path.endsWith("/ready")) operation.responses[503] = { description: "DATABASE_UNAVAILABLE", content: { "application/json": { schema: errorSchema } } };
      continue;
    }
    if (contract.body) operation.requestBody = { required: true, content: { "application/json": { schema: contract.body } } };
    const parameters: import("@nestjs/swagger/dist/interfaces/open-api-spec.interface").ParameterObject[] = [];
    for (const name of contract.path.matchAll(/{([^}]+)}/g)) parameters.push({ name: name[1], in: "path" as const, required: true, schema: { type: "string" as const, pattern: "^[A-Za-z0-9_-]{1,200}$" } });
    if (contract.path === "/api/account-closure") parameters.push({ name: "Idempotency-Key", in: "header" as const, required: true, schema: { type: "string" as const, format: "uuid" } });
    if (["/api/videos/me", "/api/blocks/me", "/api/moderation/reports"].includes(contract.path)) parameters.push({ name: "cursor", in: "query" as const, required: false, schema: { type: "string" as const, description: "Use the opaque nextCursor returned by the preceding page." } });
    if (contract.path === "/api/moderation/reports" && contract.method === "get") parameters.push({ name: "status", in: "query" as const, required: false, schema: { type: "string", enum: ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"] } });
    if (contract.method !== "get") parameters.push({ name: "Origin", in: "header" as const, required: true, schema: { type: "string" as const, format: "uri" } });
    operation.parameters = parameters;
    for (const status of [400, 403, 429, 503, ...(contract.security || contract.path === "/api/auth/login" ? [401] : []), ...(contract.body ? [413, 415] : []), ...(/videos|moderation/.test(contract.path) ? [404, 409] : []), ...(contract.path === "/api/account-closure" || contract.path.startsWith("/api/auth/staff-mfa") ? [409] : []), ...(contract.path === "/api/blocks" ? [404] : [])]) {
      operation.responses[status] = { description: ({ 400: "Invalid request, expired token or failed reauthentication.", 401: "No active verified session.", 403: "Origin, role, ownership or assurance denied.", 404: "Resource unavailable to the caller.", 409: "State, generation or revision conflict.", 413: "Request body too large.", 415: "Unsupported JSON content type.", 429: "Quota exceeded. Manual retry only after Retry-After seconds.", 503: "Required service or release gate unavailable." } as Record<number,string>)[status], content: { "application/json": { schema: errorSchema } }, ...(status === 429 ? { headers: { "Retry-After": { description: "Whole seconds until retry is permitted.", schema: { type: "integer", minimum: 1 } } } } : {}) };
    }
  }
  return document;
}
