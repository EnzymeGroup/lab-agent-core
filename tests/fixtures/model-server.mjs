import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Deterministic transport fixture. Exercises Pi's real provider and tool loop;
// deliberately makes no claim about model reasoning or provider credentials.
export async function startModelServer(handler = () => ({ text: 'Fixture complete.' })) {
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const request = JSON.parse(body);
      requests.push(request);
      const reply = await handler(request, requests.length - 1);
      if (reply.status) {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: reply.text || 'Fixture failure', type: 'fixture_error' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.flushHeaders();
      if (reply.delayMs) await new Promise(resolve => {
        const timer = setTimeout(resolve, reply.delayMs);
        res.once('close', () => { clearTimeout(timer); resolve(); });
      });
      if (res.destroyed) return;
      const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
        id: `fixture-${requests.length}`, object: 'chat.completion.chunk', created: 1,
        model: request.model, choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`);
      send({ role: 'assistant' });
      if (reply.toolCalls?.length) {
        send({ tool_calls: reply.toolCalls.map((tool, index) => ({
          index, id: `call_${requests.length}_${index}`, type: 'function',
          function: { name: tool.name, arguments: JSON.stringify(tool.arguments) },
        })) });
        send({}, 'tool_calls');
      } else {
        send({ content: reply.text ?? 'Fixture complete.' });
        send({}, 'stop');
      }
      res.end('data: [DONE]\n\n');
    } catch (error) {
      res.destroy(error);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  return { baseUrl, url: baseUrl, requests, close: () => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }) };
}

export async function writeModelConfig(agentDir, baseUrl) {
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { fixture: {
    baseUrl, api: 'openai-completions', apiKey: 'local-fixture-only',
    models: [{ id: 'fixture', name: 'Deterministic test fixture', reasoning: false,
      input: ['text'], contextWindow: 32000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }));
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({
    defaultProvider: 'fixture', defaultModel: 'fixture', defaultThinkingLevel: 'off',
    retry: { enabled: false }, compaction: { enabled: false },
  }));
}

export function lastUserText(request) {
  const message = request.messages.findLast(message => message.role === 'user');
  return typeof message.content === 'string' ? message.content
    : message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
}
