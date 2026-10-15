export type DeckEntry = {
    id: string;
    count: number;
};

export type DeckList = {
    name: string;
    main: DeckEntry[];
    runes?: DeckEntry[];
    legend?: string;
    champion?: string;
};

const artFiles = import.meta.glob('../../card assets/*.{webp,png,jpg,jpeg}', {
    eager: true,
    import: 'default'
}) as Record<string, string>;

const deckFiles = import.meta.glob('../decks/*.json', {
    eager: true,
    import: 'default'
}) as Record<string, unknown>;

const isCardBack = (path: string) => /card\s*back/i.test(path);
const isRuneBack = (path: string) => /rune\s*back/i.test(path);
const isLegendBack = (path: string) => /legend\s*back/i.test(path);
const isBack = (path: string) => /back/i.test(path);

const fileStem = (path: string) => {
    const file = path.split('/').pop() ?? path;
    return file.replace(/\.[^.]+$/, '');
};

const library = new Map<string, string>();
let backUrl = '';
let runeBackUrl = '';
let legendBackUrl = '';

for (const [path, url] of Object.entries(artFiles)) {
    if (isCardBack(path)) {
        backUrl = url;
        continue;
    }
    if (isRuneBack(path)) {
        runeBackUrl = url;
        continue;
    }
    if (isLegendBack(path)) {
        legendBackUrl = url;
        continue;
    }
    if (isBack(path)) {
        continue;
    }
    library.set(fileStem(path), url);
}

const isEntries = (value: unknown): value is DeckEntry[] => Array.isArray(value)
    && value.every((entry) => typeof entry?.id === 'string' && typeof entry.count === 'number');

const isDeckList = (value: unknown): value is DeckList => {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const list = value as DeckList;
    return typeof list.name === 'string'
        && isEntries(list.main)
        && (list.runes === undefined || isEntries(list.runes))
        && (list.legend === undefined || typeof list.legend === 'string')
        && (list.champion === undefined || typeof list.champion === 'string');
};

const expand = (entries: DeckEntry[], deckName: string) => {
    const copies: string[] = [];
    for (const entry of entries) {
        if (!Number.isFinite(entry.count) || entry.count < 0) {
            console.warn(`Deck "${deckName}" was not loaded because "${entry.id}" has an invalid count.`);
            return null;
        }
        const count = Math.floor(entry.count);
        if (count < 1) {
            continue;
        }
        const art = library.get(entry.id);
        if (!art) {
            console.warn(`Deck "${deckName}" was not loaded because there is no image for "${entry.id}".`);
            return null;
        }
        for (let i = 0; i < count; i++) {
            copies.push(art);
        }
    }
    return copies;
};

/** Copies to deal, or null when the list or a card back cannot be built. */
export const resolveDeck = (list: DeckList) => {
    if (!backUrl) {
        console.warn(`Deck "${list.name}" was not loaded because card back.png is missing.`);
        return null;
    }
    const copies = expand(list.main, list.name);
    if (!copies) {
        return null;
    }
    const runeEntries = list.runes ?? [];
    if (runeEntries.length > 0 && !runeBackUrl) {
        console.warn(`Deck "${list.name}" was not loaded because rune back.png is missing.`);
        return null;
    }
    const runes = expand(runeEntries, list.name);
    if (!runes) {
        return null;
    }
    const legendId = list.legend?.trim() ?? '';
    let legend: { art: string; back: string } | null = null;
    if (legendId) {
        if (!legendBackUrl) {
            console.warn(`Deck "${list.name}" was not loaded because legend back.png is missing.`);
            return null;
        }
        const art = library.get(legendId);
        if (!art) {
            console.warn(`Deck "${list.name}" was not loaded because there is no image for "${legendId}".`);
            return null;
        }
        legend = { art, back: legendBackUrl };
    }
    const championId = list.champion?.trim() ?? '';
    let champion: { art: string; back: string } | null = null;
    if (championId) {
        const art = library.get(championId);
        if (!art) {
            console.warn(`Deck "${list.name}" was not loaded because there is no image for "${championId}".`);
            return null;
        }
        champion = { art, back: backUrl };
    }
    return { back: backUrl, copies, runeBack: runeBackUrl, runes, legend, champion };
};

export const loadDeckLists = () => {
    const lists = Object.values(deckFiles).filter(isDeckList);
    lists.sort((a, b) => a.name.localeCompare(b.name));
    return lists;
};
