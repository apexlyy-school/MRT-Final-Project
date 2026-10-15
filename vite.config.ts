import { defineConfig } from 'vite';

const imageHost = 'https://cmsassets.rgpub.io/';

type ImageResponse = {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body?: Uint8Array | string) => void;
};

const proxyCardImage = async (request: { url?: string }, response: ImageResponse) => {
    const target = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('src');
    if (!target?.startsWith(imageHost)) {
        response.statusCode = 400;
        response.end('Unsupported card image');
        return;
    }
    try {
        const remote = await fetch(target);
        if (!remote.ok) {
            response.statusCode = remote.status;
            response.end();
            return;
        }
        const type = remote.headers.get('content-type');
        if (type) {
            response.setHeader('Content-Type', type);
        }
        response.setHeader('Cache-Control', 'public, max-age=86400');
        response.end(new Uint8Array(await remote.arrayBuffer()));
    } catch {
        response.statusCode = 502;
        response.end();
    }
};

const serveCardImage = (request: unknown, response: unknown, next: () => void) => {
    const incoming = request as { method?: string; url?: string };
    if (incoming.method !== 'GET') {
        next();
        return;
    }
    void proxyCardImage(incoming, response as ImageResponse);
};

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        {
            name: 'card-image-proxy',
            configureServer(server) {
                server.middlewares.use('/card-image', serveCardImage);
            },
            configurePreviewServer(server) {
                server.middlewares.use('/card-image', serveCardImage);
            }
        },
        {
            // Dev only: install the PlayCanvas Inspector before the app starts (press ` to toggle)
            name: 'playcanvas-inspector',
            apply: 'serve',
            config: () => ({ optimizeDeps: { include: ['@playcanvas/inspector'] } }),
            transformIndexHtml: () => [
                { tag: 'script', attrs: { type: 'module', src: '/src/inspector.ts' }, injectTo: 'head-prepend' }
            ]
        }
    ]
});
