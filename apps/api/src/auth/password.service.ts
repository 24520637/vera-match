import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";
import { EnvironmentService } from "../config/environment.service";

@Injectable()
export class PasswordService {
  constructor(private readonly environment: EnvironmentService) {}

  private validPassword(password: string) {
    return (
      typeof password === "string" &&
      Buffer.byteLength(password, "utf8") >= 1 &&
      Buffer.byteLength(password, "utf8") <= 1024
    );
  }

  async hash(password: string): Promise<string> {
    if (!this.validPassword(password))
      throw new Error("Password must contain between 1 and 1024 UTF-8 bytes.");
    try {
      return await argon2.hash(password, {
        type: argon2.argon2id,
        version: 0x13,
        hashLength: 32,
        ...this.environment.values.password,
      });
    } catch {
      throw new Error("Password hashing is unavailable.");
    }
  }

  async verify(storedHash: string, password: string): Promise<boolean> {
    if (
      !this.validPassword(password) ||
      typeof storedHash !== "string" ||
      storedHash.length > 512
    )
      return false;
    const parts =
      /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$[A-Za-z0-9+/]{16,128}\$[A-Za-z0-9+/]{32,128}$/.exec(
        storedHash,
      );
    if (!parts) return false;
    // Bound native verification even if a stored PHC string is corrupt or malicious.
    const [memory, iterations, lanes] = parts.slice(1).map(Number);
    if (
      memory < 8 ||
      memory > 262144 ||
      iterations < 1 ||
      iterations > 10 ||
      lanes < 1 ||
      lanes > 4 ||
      memory < 8 * lanes
    )
      return false;
    try {
      return await argon2.verify(storedHash, password);
    } catch {
      return false;
    }
  }
}
