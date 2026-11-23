import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { StaffDirectiveVerifier, type StaffDirective } from "./staff-directive";

@Injectable()
export class StaffAuthority {
  private readonly verifier?: StaffDirectiveVerifier;
  constructor() {
    const path = process.env.STAFF_AUTHORITY_KEYS_PATH;
    if (!path) return;
    try {
      if (!isAbsolute(path) || statSync(path).size > 131072) throw new Error();
      const config = JSON.parse(readFileSync(path,"utf8")) as Record<string,unknown>;
      if (!config || Object.keys(config).sort().join(",") !== "keys,schemaVersion" || config.schemaVersion !== 1 || !Array.isArray(config.keys)) throw new Error();
      const keys = new Map<string,string>();
      for (const entry of config.keys) {
        if (!entry || typeof entry !== "object" || Object.keys(entry).sort().join(",") !== "id,publicKeyPem" || typeof entry.id !== "string" || typeof entry.publicKeyPem !== "string" || keys.has(entry.id)) throw new Error();
        keys.set(entry.id,entry.publicKeyPem);
      }
      this.verifier = new StaffDirectiveVerifier(keys);
    } catch { throw new Error("STAFF_AUTHORITY_CONFIGURATION_INVALID"); }
  }
  verify(serialized: string, now: Date): Readonly<StaffDirective> {
    if (!this.verifier) throw new ServiceUnavailableException({code:"STAFF_AUTHORITY_UNAVAILABLE",message:"Trusted staff authority is not configured."});
    return this.verifier.verify(serialized,now);
  }
}
