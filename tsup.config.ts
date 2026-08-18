import { defineConfig } from 'tsup';

// Bundles bin.ts + its local imports (register/tools/context) into one ESM file.
// zod and @modelcontextprotocol/sdk stay external (declared deps). Shebang is
// preserved from bin.ts, so the published dist/bin.js is runnable via npx.
export default defineConfig({
  entry: { bin: 'src/bin.ts', index: 'src/index.ts' },
  format: 'esm',
  target: 'node18',
  clean: true,
});
