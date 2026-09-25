/** Cloudflare Worker entry point for the vinext-starter template. */
import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from 'vinext/server/image-optimization';
import handler from 'vinext/server/app-router-entry';

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

// Content Security Policy. Vinext streams inline bootstrap/RSC scripts whose
// content changes per request, so hashes cannot be used; instead a fresh nonce
// is placed in a `content-security-policy` request header, which vinext reads
// to add `nonce` to every inline script it emits. 'wasm-unsafe-eval' lets the
// self-hosted Tesseract OCR worker compile its WebAssembly core.
function contentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://images.openfoodfacts.org https://*.openfoodfacts.org",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}
function createNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/_vinext/image') {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    const nonce = createNonce();
    const policy = contentSecurityPolicy(nonce);
    const forwarded = new Request(request);
    forwarded.headers.set('content-security-policy', policy);
    const response = await handler.fetch(forwarded, env, ctx);
    const secured = new Response(response.body, response);
    if (url.pathname === '/' && response.ok) secured.headers.set('X-Same-Again-Shell', '1');
    secured.headers.set('Content-Security-Policy', policy);
    secured.headers.set('X-Frame-Options', 'DENY');
    secured.headers.set('X-Content-Type-Options', 'nosniff');
    secured.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    secured.headers.set('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
    secured.headers.set('Strict-Transport-Security', 'max-age=31536000');
    // Routes that choose their own caching (for example the public demo
    // catalogue or ETag-validated household data) keep it.
    if (url.pathname.startsWith('/api/') && !response.headers.has('Cache-Control'))
      secured.headers.set('Cache-Control', 'no-store');
    return secured;
  },
};

export default worker;
