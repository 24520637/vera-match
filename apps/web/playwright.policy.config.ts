import { defineConfig } from "@playwright/test";
import member from "./playwright.member.config";
/** Same real isolated API/session harness, with an ephemeral signed test authority. */
export default defineConfig({ ...member, testMatch: "**/*.policy-e2e.ts" });
