import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, 'dist');

// Ensure dist directory exists (non-blocking fallback)
if (!fs.existsSync(DIST_DIR)) {
  console.log('[SERVER] dist/ directory not found at startup. Running build...');
  try {
    execSync('npm run build', { stdio: 'inherit' });
  } catch (err) {
    console.error('[SERVER] Background build warning:', err);
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

function getSafeFilePath(urlPath) {
  const cleanPath = decodeURI(urlPath.split('?')[0].split('#')[0]);
  const normalized = path.normalize(cleanPath).replace(/^(\.\.[\/\\])+/, '');
  
  // Try exact path
  let candidate = path.join(DIST_DIR, normalized);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }

  // If path ends with / or is root
  if (normalized === '/' || normalized === '') {
    candidate = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(candidate)) return candidate;
  }

  // Try appending .html
  candidate = path.join(DIST_DIR, `${normalized}.html`);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }

  // Try folder/index.html
  candidate = path.join(DIST_DIR, normalized, 'index.html');
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }

  return null;
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const server = http.createServer((req, res) => {
  const method = req.method || 'GET';
  const url = req.url || '/';

  // Basic CORS & security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Health check endpoints commonly used by Cloud Run / GCP
  if (url === '/_health' || url === '/healthz' || url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  const filePath = getSafeFilePath(url);

  if (filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Caching headers
    if (ext === '.html') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }

    res.writeHead(200, { 'Content-Type': contentType });

    if (method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', (err) => {
      console.error(`[SERVER] Stream error for ${filePath}:`, err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      res.end('Internal Server Error');
    });
    return;
  }

  // Fallback to index.html for SPA routing if requested non-asset path
  const indexPath = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath) && !path.extname(url)) {
    res.writeHead(200, { 
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(indexPath).pipe(res);
    return;
  }

  // 404 Not Found
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`[SERVER] Production server listening on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SERVER] SIGTERM signal received. Closing HTTP server...');
  server.close(() => {
    console.log('[SERVER] HTTP server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[SERVER] SIGINT signal received. Closing HTTP server...');
  server.close(() => {
    console.log('[SERVER] HTTP server closed.');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  console.error('[SERVER] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER] Unhandled rejection at:', promise, 'reason:', reason);
});
