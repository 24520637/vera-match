import { fileURLToPath } from "node:url";

/** Isolated test app: never imported by the product's Next.js configuration. */
export default {
  reactStrictMode: true,
  outputFileTracingRoot: fileURLToPath(new URL("../../../../../", import.meta.url)),
};
