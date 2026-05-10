import type { Request, Response, NextFunction } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './server.js';

/**
 * Auth specifically for the MCP endpoint. We accept the bearer either via
 * the Authorization header *or* a `?token=` query param — Claude.ai's Custom
 * Connectors UI lets users specify a full URL including query parameters but
 * doesn't have a generic header-injection field. Falls back to no-auth if
 * neither API_TOKEN nor a Google sign-in JWT setup is configured.
 */
export function mcpAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = process.env.API_TOKEN;
  if (!expected) {
    next();
    return;
  }
  const fromHeader = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const fromQuery = typeof req.query.token === 'string' ? req.query.token : '';
  if (fromHeader === expected || fromQuery === expected) {
    next();
    return;
  }
  res.status(401).json({ error: 'unauthorized' });
}

/**
 * Express handler that bridges a single HTTP request to the MCP server using
 * a stateless Streamable HTTP transport. A fresh transport per request keeps
 * the implementation simple and side-effect-free — appropriate for a
 * single-user system where session continuity isn't needed.
 */
export async function mcpHandler(req: Request, res: Response): Promise<void> {
  try {
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp] handler error', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'mcp_internal_error' });
    }
  }
}
