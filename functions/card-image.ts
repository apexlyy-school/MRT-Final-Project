const imageHost = 'https://cmsassets.rgpub.io/';

/** Same-origin proxy so WebGL can load Riot CMS card art on Cloudflare Pages. */
export const onRequestGet = async (context: { request: Request }) => {
    const target = new URL(context.request.url).searchParams.get('src');
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
};
