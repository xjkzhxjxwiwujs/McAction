import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

let clientPromise = null;

async function createClient() {
  const token = process.env.MCD_MCP_TOKEN;
  if (!token) throw new Error('缺少 MCD_MCP_TOKEN，请在 .env 或 ~/.mcaction/.env 中配置');
  const transport = new StreamableHTTPClientTransport(
    new URL(process.env.MCD_MCP_URL || 'https://mcp.mcd.cn'),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const client = new Client({ name: 'mcaction', version: '0.1.0' });
  await client.connect(transport);
  return { client, transport };
}

function getClient() {
  if (!clientPromise) {
    clientPromise = createClient().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

export async function callMcpTool(name, args = {}) {
  try {
    const { client } = await getClient();
    return parseToolResult(await client.callTool({ name, arguments: args }));
  } catch (err) {
    if (err.business) throw err;
    clientPromise = null;
    const { client } = await getClient();
    return parseToolResult(await client.callTool({ name, arguments: args }));
  }
}

function extractText(result) {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

function businessError(message, raw) {
  const error = new Error(message);
  error.business = true;
  error.raw = raw;
  return error;
}

function parseToolResult(result) {
  if (result?.isError) throw businessError(extractText(result) || 'MCP 工具调用失败', result);

  let parsed = result?.structuredContent;
  if (!parsed || typeof parsed !== 'object') {
    const text = extractText(result);
    if (!text) return result;
    try {
      parsed = JSON.parse(text);
    } catch {
      const tail = text.match(/\{[\s\S]*\}\s*$/);
      try {
        parsed = tail ? JSON.parse(tail[0]) : { rawText: text };
      } catch {
        parsed = { rawText: text };
      }
    }
  }

  if (parsed?.success === false) {
    throw businessError(parsed.message || `业务错误 ${parsed.code || ''}`.trim(), parsed);
  }
  return parsed;
}

export async function closeMcpClient() {
  if (!clientPromise) return;
  try {
    const { client, transport } = await clientPromise;
    await client.close?.();
    await transport.close?.();
  } catch {
    // 退出阶段的关闭失败不影响结果
  } finally {
    clientPromise = null;
  }
}
