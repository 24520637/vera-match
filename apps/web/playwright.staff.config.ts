import { defineConfig } from "@playwright/test";
import member from "./playwright.member.config";
export default defineConfig({...member,testMatch:"**/*.staff-e2e.ts"});
