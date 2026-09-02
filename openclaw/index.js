import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

// Everything this plugin ships — the Postfleet MCP server and the skill that
// teaches an agent to drive it — is declared statically in openclaw.plugin.json.
// The entry exists because OpenClaw only loads a package as a native plugin when
// package.json points at a runtime module; there is nothing to register here.
export default definePluginEntry({
  id: 'postfleet',
  name: 'Postfleet',
  description: 'Give an AI agent its own email address: send, reply, read, and wait for mail.',
  register() {},
});
