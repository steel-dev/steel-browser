import http, { IncomingHttpHeaders } from "node:http";

// Headers that are hop-by-hop and should not be forwarded RFC 2616, Section 13.5.1
const hopByHopHeaders = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
];

/**
 * Creates a simple http proxy which reverse proxies the original request to the original host.
 * There's an issue with proxy-chain's implementation causing corruption in our internals requests
 */
export const PassthroughServer = http.createServer((clientReq, clientRes) => {
  const headerString = `{ ${Object.entries(clientReq.headers)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ")} }`;
  console.error(`Incoming clientReq.headers: ${headerString}`);

  const targetUrl = new URL(clientReq.url ?? "/", `http://${clientReq.headers.host}`);

  const proxyHeaders: IncomingHttpHeaders = {};
  for (const [key, value] of Object.entries(clientReq.headers)) {
    const lowerKey = key.toLowerCase();
    if (!hopByHopHeaders.includes(lowerKey)) {
      proxyHeaders[lowerKey] = value;
    }
  }

  proxyHeaders['host'] = targetUrl.host;
  proxyHeaders['x-forwarded-for'] = clientReq.socket.remoteAddress || '';
  proxyHeaders['x-forwarded-proto'] = 'http';
  proxyHeaders['x-forwarded-host'] = clientReq.headers.host || '';

  const forwardingHeaderString = `{ ${Object.entries(proxyHeaders)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ")} }`;
  console.error(`Forwarding headers to target: ${forwardingHeaderString}`);

  const proxyReq = http.request({
    method: clientReq.method,
    headers: proxyHeaders,
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    path: targetUrl.pathname + targetUrl.search,
  }, (proxyRes) => {
    const clientResHeaders = {};
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (!hopByHopHeaders.includes(key.toLowerCase())) {
        clientResHeaders[key] = value;
      }
    }
    
    clientRes.writeHead(proxyRes.statusCode ?? 500, clientResHeaders);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on("error", (err) => {
    console.error(`Proxy error for ${targetUrl}:`, err);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502);
    }
    clientRes.end("Proxy error: Could not connect to the target service.");
  });

  clientReq.on('error', (err) => {
    console.error(`Client request error:`, err);
    proxyReq.destroy();
  });

  clientReq.pipe(proxyReq);
});