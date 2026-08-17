import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Minimal loopback HTTP server, the analogue of Go's `httptest.NewServer`.
 *
 * Real HTTP over 127.0.0.1 with no mocking library, so the retry wrapper, header
 * handling and `Link` following are all exercised for real -- which is the point.
 */
export interface TestServer {
  url: string;
  close(): Promise<void>;
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export async function startServer(handler: Handler): Promise<TestServer> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        await handler(req, res);
      } catch (err) {
        if (!res.headersSent) res.writeHead(500);
        res.end(String(err));
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export function writeJSON(
  res: ServerResponse,
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body);
}

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function query(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? "/", "http://localhost").searchParams;
}

export function pathname(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}
