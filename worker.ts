const imageHost = 'https://cmsassets.rgpub.io/';

type Env = {
    ASSETS: { fetch: (request: Request) => Promise<Response> };
};

/** Proxies Riot CMS card art, then falls through to the Vite static build. */
export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === '/card-image') {
            if (request.method !== 'GET' && request.method !== 'HEAD') {
                return new Response('Method not allowed', { status: 405 });
            }
            const target = url.searchParams.get('src');
            if (!target?.startsWith(imageHost)) {
                return new Response('Unsupported card image', { status: 400 });
            }
            try {
                const remote = await fetch(target);
                if (!remote.ok) {
                    return new Response(null, { status: remote.status });
                }
                const headers = new Headers();
                const type = remote.headers.get('content-type');
                if (type) {
                    headers.set('Content-Type', type);
                }
                headers.set('Cache-Control', 'public, max-age=86400');
                return new Response(remote.body, { status: 200, headers });
            } catch {
                return new Response(null, { status: 502 });
            }
        }
        return env.ASSETS.fetch(request);
    }
};
