import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';

// A tiny JSON-RPC stdio server; the production MCP client remains Pi's native one.
if (process.env.MCP_PID_FILE) writeFileSync(process.env.MCP_PID_FILE, String(process.pid));
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  let result;
  switch (request.method) {
    case 'initialize': result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'lab-fixture', version: '1.0.0' } }; break;
    case 'tools/list': result = { tools: [{ name: 'double', description: 'Double a number', inputSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] } }] }; break;
    case 'tools/call': result = { content: [{ type: 'text', text: String(request.params.arguments.value * 2) }] }; break;
    case 'ping': result = {}; break;
    default: process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown method' } })+'\n'); continue;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result })+'\n');
}
