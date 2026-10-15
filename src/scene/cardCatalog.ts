export type DeckEntry = {
    id: string;
    count: number;
};

export type DeckList = {
    name: string;
    main: DeckEntry[];
    runes?: DeckEntry[];
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
const isBack = (path: string) => /back/i.test(path);

const fileStem = (path: string) => {
    const file = path.split('/').pop() ?? path;
    return file.replace(/\.[^.]+$/, '');
};

const library = new Map<string, string>();
let backUrl = '';
let runeBackUrl = '';

for (const [path, url] of Object.entries(artFiles)) {
    if (isCardBack(path)) {
        backUrl = url;
        continue;
    }
    if (isRuneBack(path)) {
        runeBackUrl = url;
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
        && (list.runes === undefined || isEntries(list.runes));
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
    return { back: backUrl, copies, runeBack: runeBackUrl, runes };
};

export const loadDeckLists = () => {
    const lists = Object.values(deckFiles).filter(isDeckList);
    lists.sort((a, b) => a.name.localeCompare(b.name));
    return lists;
};
