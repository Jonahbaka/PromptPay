import { CONFIG } from '../../core/config.js';

interface JsonRpcSuccess<T> {
  jsonrpc: '2.0';
  id?: string | number | null;
  result: T;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id?: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpResourceDescriptor {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

interface McpPromptDescriptor {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

interface McpCallToolResult {
  content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

interface McpServerConfig {
  name: string;
  url: string;
  enabled: boolean;
  bearerToken?: string;
  headers?: Record<string, string>;
}

interface McpSessionState {
  sessionId?: string;
  initialized: boolean;
}

function controllerWithTimeout(timeoutMs: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller;
}

function normalizeServerName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

function parseRpcResponse<T>(body: string): T {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Empty MCP response');

  if (trimmed.startsWith('data:')) {
    const eventPayload = trimmed
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .join('\n');
    return parseRpcResponse<T>(eventPayload);
  }

  const parsed = JSON.parse(trimmed) as JsonRpcSuccess<T> | JsonRpcError;
  if ('error' in parsed) {
    throw new Error(parsed.error.message || 'MCP request failed');
  }
  return parsed.result;
}

export function isSensitiveMcpToolName(toolName: string): boolean {
  return /(deploy|delete|remove|destroy|restart|reload|reset|write|update|create|transfer|payment|charge|rotate|secret|token|credential|config)/i.test(toolName);
}

class OpenClawMcpRegistry {
  private sessions = new Map<string, McpSessionState>();

  listServers(): McpServerConfig[] {
    return CONFIG.mcp.servers
      .filter(server => server.enabled && server.url)
      .map(server => ({
        name: normalizeServerName(server.name),
        url: server.url,
        enabled: server.enabled,
        bearerToken: server.bearerToken,
        headers: server.headers,
      }));
  }

  getServer(name: string): McpServerConfig | null {
    const normalized = normalizeServerName(name);
    return this.listServers().find(server => normalizeServerName(server.name) === normalized) || null;
  }

  async listTools(serverName: string): Promise<McpToolDescriptor[]> {
    const result = await this.rpc<{ tools?: McpToolDescriptor[] }>(serverName, 'tools/list', {});
    return result.tools || [];
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<McpCallToolResult> {
    return this.rpc<McpCallToolResult>(serverName, 'tools/call', {
      name: toolName,
      arguments: args,
    });
  }

  async listResources(serverName: string): Promise<McpResourceDescriptor[]> {
    const result = await this.rpc<{ resources?: McpResourceDescriptor[] }>(serverName, 'resources/list', {});
    return result.resources || [];
  }

  async readResource(serverName: string, uri: string): Promise<unknown> {
    return this.rpc<unknown>(serverName, 'resources/read', { uri });
  }

  async listPrompts(serverName: string): Promise<McpPromptDescriptor[]> {
    const result = await this.rpc<{ prompts?: McpPromptDescriptor[] }>(serverName, 'prompts/list', {});
    return result.prompts || [];
  }

  async getPrompt(serverName: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.rpc<unknown>(serverName, 'prompts/get', {
      name,
      arguments: args,
    });
  }

  private async ensureInitialized(server: McpServerConfig): Promise<void> {
    const key = normalizeServerName(server.name);
    const existing = this.sessions.get(key);
    if (existing?.initialized) return;

    await this.rpcRaw(server, 'initialize', {
      protocolVersion: CONFIG.mcp.protocolVersion,
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      clientInfo: {
        name: 'promptpay-openclaw',
        version: CONFIG.platform.version,
      },
    });

    await this.rpcRaw(server, 'notifications/initialized', undefined, true);
    this.sessions.set(key, {
      sessionId: this.sessions.get(key)?.sessionId,
      initialized: true,
    });
  }

  private async rpc<T>(serverName: string, method: string, params?: Record<string, unknown>): Promise<T> {
    const server = this.getServer(serverName);
    if (!server) throw new Error(`Unknown MCP server: ${serverName}`);
    await this.ensureInitialized(server);
    const result = await this.rpcRaw<T>(server, method, params);
    return result;
  }

  private async rpcRaw<T>(
    server: McpServerConfig,
    method: string,
    params?: Record<string, unknown>,
    notification = false,
  ): Promise<T> {
    const session = this.sessions.get(normalizeServerName(server.name));
    const headers: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...(server.headers || {}),
    };

    if (server.bearerToken) headers.Authorization = `Bearer ${server.bearerToken}`;
    if (session?.sessionId) headers['mcp-session-id'] = session.sessionId;

    const controller = controllerWithTimeout(CONFIG.mcp.requestTimeoutMs);
    const body = notification
      ? { jsonrpc: '2.0', method, params }
      : { jsonrpc: '2.0', id: `${Date.now()}`, method, params: params || {} };

    const res = await fetch(server.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const sessionId = res.headers.get('mcp-session-id') || undefined;
    if (sessionId) {
      this.sessions.set(normalizeServerName(server.name), {
        sessionId,
        initialized: method === 'initialize' || session?.initialized || false,
      });
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`MCP ${server.name} ${method} failed (${res.status}): ${errorText.slice(0, 300)}`);
    }

    if (notification) {
      return undefined as T;
    }

    const text = await res.text();
    return parseRpcResponse<T>(text);
  }
}

export const openClawMcp = new OpenClawMcpRegistry();
