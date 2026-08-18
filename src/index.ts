// Public surface consumed by the Next app (src/app/api/[transport]/route.ts).
// The bin (bin.ts) imports the same registerTools for the local stdio transport.
export { registerTools } from './register';
export type { McpServerLike } from './register';
export type { ToolCtx } from './context';
