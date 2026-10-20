import { cardByName, proxiedCardImage } from './riftcodex.ts';

export type DeckEntry = {
    name: string;
    count: number;
};

export type DeckList = {
    name: string;
    main: DeckEntry[];
    runes?: DeckEntry[];
    battlefields?: DeckEntry[];
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
const isBattlefieldBack = (path: string) => /battlefield\s*back/i.test(path);

let backUrl = '';
let runeBackUrl = '';
let legendBackUrl = '';
let battlefieldBackUrl = '';

for (const [path, url] of Object.entries(artFiles)) {
    if (isCardBack(path)) {
        backUrl = url;
    } else if (isRuneBack(path)) {
        runeBackUrl = url;
    } else if (isLegendBack(path)) {
        legendBackUrl = url;
    } else if (isBattlefieldBack(path)) {
        battlefieldBackUrl = url;
    }
}

export const battlefieldBack = () => battlefieldBackUrl || null;

const isEntries = (value: unknown): value is DeckEntry[] => Array.isArray(value)
    && value.every((entry) => typeof entry?.name === 'string' && typeof entry.count === 'number');

const isDeckList = (value: unknown): value is DeckList => {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const list = value as DeckList;
    return typeof list.name === 'string'
        && isEntries(list.main)
        && (list.runes === undefined || isEntries(list.runes))
        && (list.battlefields === undefined || isEntries(list.battlefields))
        && (list.legend === undefined || typeof list.legend === 'string')
        && (list.champion === undefined || typeof list.champion === 'string');
};

const artFor = async (name: string, deckName: string) => {
    const card = await cardByName(name);
    if (card) {
        return proxiedCardImage(card.image);
    }
    console.warn(`Deck "${deckName}" was not loaded because there is no image for "${name}".`);
    return null;
};

const expand = async (entries: DeckEntry[], deckName: string) => {
    for (const entry of entries) {
        if (!Number.isFinite(entry.count) || entry.count < 0) {
            console.warn(`Deck "${deckName}" was not loaded because "${entry.name}" has an invalid count.`);
            return null;
        }
    }
    const cardNames = [...new Set(entries.filter((entry) => Math.floor(entry.count) >= 1).map((entry) => entry.name))];
    const found = new Map<string, string>();
    await Promise.all(cardNames.map(async (name) => {
        const art = await artFor(name, deckName);
        if (art) {
            found.set(name, art);
        }
    }));
    const copies: string[] = [];
    for (const entry of entries) {
        const count = Math.floor(entry.count);
        if (count < 1) {
            continue;
        }
        const art = found.get(entry.name);
        if (!art) {
            return null;
        }
        for (let i = 0; i < count; i++) {
            copies.push(art);
        }
    }
    return copies;
};

/** Copies to deal, or null when the list or a card back cannot be built. */
export const resolveDeck = async (list: DeckList) => {
    if (!backUrl) {
        console.warn(`Deck "${list.name}" was not loaded because card back.png is missing.`);
        return null;
    }
    const runeEntries = list.runes ?? [];
    if (runeEntries.length > 0 && !runeBackUrl) {
        console.warn(`Deck "${list.name}" was not loaded because rune back.png is missing.`);
        return null;
    }
    const legendName = list.legend?.trim() ?? '';
    if (legendName && !legendBackUrl) {
        console.warn(`Deck "${list.name}" was not loaded because legend back.png is missing.`);
        return null;
    }
    const championName = list.champion?.trim() ?? '';
    const battlefieldNames = [...new Set(
        (list.battlefields ?? [])
            .filter((entry) => Math.floor(entry.count) >= 1)
            .map((entry) => entry.name.trim())
            .filter(Boolean)
    )];
    const [copies, runes, legendArt, championArt, ...battlefieldArts] = await Promise.all([
        expand(list.main, list.name),
        expand(runeEntries, list.name),
        legendName ? artFor(legendName, list.name) : Promise.resolve(null),
        championName ? artFor(championName, list.name) : Promise.resolve(null),
        ...battlefieldNames.map((name) => artFor(name, list.name))
    ]);
    if (!copies || !runes || (legendName && !legendArt) || (championName && !championArt)) {
        return null;
    }
    const battlefields = battlefieldArts.filter((art): art is string => Boolean(art));
    if (battlefieldNames.length > 0 && battlefields.length === 0) {
        console.warn(`Deck "${list.name}" has no usable battlefield art; battlefield 1 will stay blank.`);
    }
    return {
        back: backUrl,
        copies,
        runeBack: runeBackUrl,
        runes,
        legend: legendName && legendArt ? { art: legendArt, back: legendBackUrl } : null,
        champion: championName && championArt ? { art: championArt, back: backUrl } : null,
        battlefields
    };
};

export const loadDeckLists = () => {
    const lists = Object.values(deckFiles).filter(isDeckList);
    lists.sort((a, b) => a.name.localeCompare(b.name));
    return lists;
};
