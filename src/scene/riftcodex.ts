const nameUrl = 'https://api.riftcodex.com/cards/name';

type RiftCard = {
    name?: string;
    collector_number?: number;
    set?: { set_id?: string };
    media?: { image_url?: string };
    metadata?: { alternate_art?: boolean; signature?: boolean; overnumbered?: boolean };
};

export type NamedCard = {
    name: string;
    image: string;
};

const names = new Map<string, Promise<NamedCard | null>>();

const printingRank = (card: RiftCard) => {
    const meta = card.metadata;
    return (meta?.alternate_art ? 8 : 0)
        + (meta?.signature ? 4 : 0)
        + (meta?.overnumbered ? 2 : 0)
        + (card.set?.set_id?.toUpperCase() === 'OGN' ? 0 : 1);
};

const choosePrinting = (cards: RiftCard[]) => {
    return [...cards].sort((a, b) => {
        return printingRank(a) - printingRank(b) || (a.collector_number ?? 0) - (b.collector_number ?? 0);
    })[0];
};

const fetchNamed = async (query: string) => {
    const response = await fetch(`${nameUrl}?exact=${encodeURIComponent(query)}&size=100`);
    if (!response.ok) {
        return [];
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('items' in body) || !Array.isArray(body.items)) {
        return [];
    }
    return body.items as RiftCard[];
};

const asNamedCard = (card: RiftCard | undefined): NamedCard | null => {
    const name = card?.name?.trim();
    const image = card?.media?.image_url;
    if (!name || !image) {
        return null;
    }
    return { name, image };
};

const resolveName = async (name: string) => {
    const queries = [name];
    const dashed = name.replace(/,\s*/g, ' - ');
    if (dashed !== name) {
        queries.push(dashed);
    }
    for (const query of queries) {
        try {
            const cards = (await fetchNamed(query)).filter((card) => card.name && card.media?.image_url);
            const found = asNamedCard(choosePrinting(cards));
            if (found) {
                return found;
            }
        } catch {
            return null;
        }
    }
    return null;
};

/** The Riftcodex card for a deck name, or null when there is no exact match. */
export const cardByName = (name: string) => {
    const key = name.trim().toLowerCase();
    const cached = names.get(key);
    if (cached) {
        return cached;
    }
    const pending = resolveName(name.trim());
    names.set(key, pending);
    return pending;
};

/** Same-origin path for a remote face. The image host does not allow a WebGL texture to read it directly. */
export const proxiedCardImage = (remote: string) => `/card-image?src=${encodeURIComponent(remote)}`;
