const cardsUrl = 'https://api.riftcodex.com/cards/riftbound/';

type RiftCard = {
    riftbound_id?: string;
    media?: { image_url?: string };
    metadata?: { alternate_art?: boolean };
};

const images = new Map<string, Promise<string | null>>();

const matchesId = (card: RiftCard, id: string) => {
    const riftboundId = card.riftbound_id?.toLowerCase() ?? '';
    return riftboundId === id || riftboundId.startsWith(`${id}-`);
};

const fetchImage = async (id: string) => {
    try {
        const response = await fetch(`${cardsUrl}${encodeURIComponent(id)}`);
        if (!response.ok) {
            return null;
        }
        const cards: unknown = await response.json();
        if (!Array.isArray(cards)) {
            return null;
        }
        const exact = cards.filter((card): card is RiftCard => matchesId(card as RiftCard, id));
        const card = exact.find((item) => item.metadata?.alternate_art !== true) ?? exact[0];
        return card?.media?.image_url || null;
    } catch {
        return null;
    }
};

/** Face image URL for a Riftbound id such as OGN-037, or null when the API has no exact match. */
export const riftboundImage = (id: string) => {
    const key = id.trim().toLowerCase();
    const cached = images.get(key);
    if (cached) {
        return cached;
    }
    const pending = fetchImage(key);
    images.set(key, pending);
    return pending;
};

/** Same-origin path for a remote face. The image host does not allow a WebGL texture to read it directly. */
export const proxiedCardImage = (remote: string) => `/card-image?src=${encodeURIComponent(remote)}`;
