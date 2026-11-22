import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Exercise the dependency resolved from Prisma's config parent, outside Jest's
// ESM VM. The payloads are synthetic config graphs, not a claimed HTTP attack.
const load = `
  import { createRequire } from 'node:module';
  import { pathToFileURL } from 'node:url';
  const require = createRequire(import.meta.url);
  const fromConfig = createRequire(require.resolve('@prisma/config'));
  const { deepmerge } = await import(pathToFileURL(fromConfig.resolve('deepmerge-ts')).href);
`;
function probe(code: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", load + code], {
    cwd: resolve(__dirname, "../../../.."), windowsHide: true, timeout: 5000,
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, NODE_ENV: "test" },
    stdio: "pipe",
  }).status;
}
describe("Prisma config merge compatibility", () => {
  it("handles a recursive config graph without stack exhaustion", () => {
    expect(probe(`
      const a = {}, b = {}; a.self = a; b.self = b;
      try { const merged = deepmerge(a, b); process.exit(merged.self === merged ? 0 : 1); }
      catch { process.exit(2); }
    `)).toBe(0);
  });
  it("preserves the existing plain-record and array merge contract", () => {
    expect(probe(`
      const merged = deepmerge({ paths: { schema: 'schema.prisma' }, args: ['a'] },
        { paths: { migrations: 'migrations' }, args: ['b'] });
      process.exit(JSON.stringify(merged) === JSON.stringify({
        paths: { schema: 'schema.prisma', migrations: 'migrations' }, args: ['a', 'b']
      }) ? 0 : 1);
    `)).toBe(0);
  });
  it("rejects adversarial template input without blocking Prisma's config dependency", () => {
    expect(probe(`
      const Schema = fromConfig('effect/Schema');
      const accepts = Schema.is(Schema.TemplateLiteral(
        Schema.String, ':', Schema.String, ':', Schema.String, 'X'));
      if (!accepts('alpha:beta:gammaX') || accepts('alpha:beta:gammaY')) process.exit(2);
      process.exit(accepts(':'.repeat(5000)) ? 1 : 0);
    `)).toBe(0);
  });
});
