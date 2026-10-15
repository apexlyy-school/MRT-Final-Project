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

type DeckEntry = { name: string; count: number };

type StoredDeck = {
    name?: string;
    main?: DeckEntry[];
    runes?: DeckEntry[];
    battlefields?: DeckEntry[];
    legend?: string;
    champion?: string;
};

type FileSystem = {
    readdir: (path: URL) => Promise<string[]>;
    readFile: (path: URL, encoding: 'utf8') => Promise<string>;
    writeFile: (path: URL, data: string) => Promise<void>;
    rename: (from: URL, to: URL) => Promise<void>;
    rm: (path: URL, options: { force: boolean }) => Promise<void>;
};

const decksDir = new URL('./src/decks/', import.meta.url);

const fileSystem = async () => {
    const specifier = 'node:fs/promises';
    return import(specifier) as Promise<FileSystem>;
};

const readBody = async (request: AsyncIterable<Uint8Array>) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of request) {
        chunks.push(chunk);
    }
    const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
    }
    return new TextDecoder().decode(body);
};

const isCardName = (value: unknown): value is string => {
    return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200;
};

const isStoredEntries = (value: unknown): value is DeckEntry[] => Array.isArray(value) && value.every((entry) => {
    return !!entry && typeof entry === 'object' && isCardName(entry.name) && Number.isInteger(entry.count) && entry.count >= 1;
});

const storedDeck = (value: unknown) => {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const deck = value as StoredDeck;
    if (!isStoredEntries(deck.main)) {
        return null;
    }
    if (deck.runes !== undefined && !isStoredEntries(deck.runes)) {
        return null;
    }
    if (deck.battlefields !== undefined && !isStoredEntries(deck.battlefields)) {
        return null;
    }
    if (deck.legend !== undefined && !isCardName(deck.legend)) {
        return null;
    }
    if (deck.champion !== undefined && !isCardName(deck.champion)) {
        return null;
    }
    return {
        ...(deck.legend ? { legend: deck.legend } : {}),
        ...(deck.champion ? { champion: deck.champion } : {}),
        main: deck.main,
        ...(deck.battlefields && deck.battlefields.length > 0 ? { battlefields: deck.battlefields } : {}),
        ...(deck.runes && deck.runes.length > 0 ? { runes: deck.runes } : {})
    };
};

const deckNumber = (name: string) => {
    const match = /^Deck (\d+)$/.exec(name);
    return match ? Number(match[1]) : 0;
};

const nextDeckNumber = async (fs: FileSystem) => {
    const taken = new Set<number>();
    const files = (await fs.readdir(decksDir)).filter((file) => /^[\w.-]+\.json$/.test(file));
    for (const file of files) {
        const fromName = /^deck-(\d+)\.json$/i.exec(file);
        if (fromName) {
            taken.add(Number(fromName[1]));
        }
        try {
            const json = JSON.parse(await fs.readFile(new URL(file, decksDir), 'utf8')) as { name?: string };
            taken.add(deckNumber(json.name ?? ''));
        } catch {
            taken.add(0);
        }
    }
    let number = 1;
    while (taken.has(number)) {
        number += 1;
    }
    return number;
};

const removeFile = async (file: URL) => {
    const fs = await fileSystem();
    await fs.rm(file, { force: true });
};

const sendJson = (response: ImageResponse, status: number, body: unknown) => {
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(body));
};

const saveImportedDeck = async (request: AsyncIterable<Uint8Array>, response: ImageResponse) => {
    let temp: URL | null = null;
    let created: URL | null = null;
    try {
        const deck = storedDeck(JSON.parse(await readBody(request)));
        if (!deck) {
            sendJson(response, 400, { error: 'Invalid deck' });
            return;
        }
        const fs = await fileSystem();
        const number = await nextDeckNumber(fs);
        const saved = { name: `Deck ${number}`, ...deck };
        temp = new URL(`deck-${number}.json.tmp`, decksDir);
        created = new URL(`deck-${number}.json`, decksDir);
        await fs.writeFile(temp, `${JSON.stringify(saved, null, 4)}\n`);
        await fs.rename(temp, created);
        temp = null;
        sendJson(response, 200, saved);
    } catch {
        if (temp) {
            await removeFile(temp);
        }
        if (created) {
            await removeFile(created);
        }
        sendJson(response, 500, { error: 'Failed to save deck' });
    }
};

const deleteImportedDeck = async (request: AsyncIterable<Uint8Array>, response: ImageResponse) => {
    try {
        const body = JSON.parse(await readBody(request)) as { name?: string };
        const number = deckNumber(body.name ?? '');
        if (!number) {
            sendJson(response, 400, { error: 'Invalid deck' });
            return;
        }
        const file = new URL(`deck-${number}.json`, decksDir);
        const fs = await fileSystem();
        const json = JSON.parse(await fs.readFile(file, 'utf8')) as { name?: string };
        if (json.name !== `Deck ${number}`) {
            sendJson(response, 404, { error: 'Missing deck' });
            return;
        }
        await fs.rm(file, { force: true });
        sendJson(response, 200, { name: json.name });
    } catch {
        sendJson(response, 500, { error: 'Failed to delete deck' });
    }
};

const serveDeckImport = (request: unknown, response: unknown, next: () => void) => {
    const incoming = request as AsyncIterable<Uint8Array> & { method?: string };
    const outgoing = response as ImageResponse;
    if (incoming.method === 'POST') {
        void saveImportedDeck(incoming, outgoing);
        return;
    }
    if (incoming.method === 'DELETE') {
        void deleteImportedDeck(incoming, outgoing);
        return;
    }
    next();
};

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        {
            name: 'card-image-proxy',
            configureServer(server) {
                server.middlewares.use('/card-image', serveCardImage);
                server.middlewares.use('/deck-import', serveDeckImport);
            },
            configurePreviewServer(server) {
                server.middlewares.use('/card-image', serveCardImage);
                server.middlewares.use('/deck-import', serveDeckImport);
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
