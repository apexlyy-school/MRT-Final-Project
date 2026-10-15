import type { DeckEntry, DeckList } from './cardCatalog.ts';
import { cardByName } from './riftcodex.ts';

type Section = 'legend' | 'champion' | 'main' | 'battlefields' | 'runes' | 'sideboard';

type ParsedLine = {
    section: Exclude<Section, 'sideboard'>;
    count: number;
    name: string;
    text: string;
};

const headers: Record<string, Section> = {
    legend: 'legend',
    champion: 'champion',
    maindeck: 'main',
    battlefields: 'battlefields',
    runes: 'runes',
    sideboard: 'sideboard'
};

const readLines = (source: string) => {
    const parsed: ParsedLine[] = [];
    let section: Section | null = null;
    const seen = new Set<Section>();
    for (const raw of source.split(/\r?\n/)) {
        const text = raw.trim();
        if (!text) {
            continue;
        }
        const header = /^([A-Za-z]+)\s*:\s*$/.exec(text);
        const next = header ? headers[header[1].toLowerCase()] : undefined;
        if (header) {
            if (!next || seen.has(next)) {
                return text;
            }
            seen.add(next);
            section = next;
            continue;
        }
        if (!section || section === 'sideboard') {
            if (section === 'sideboard') {
                continue;
            }
            return text;
        }
        const card = /^(\d+)\s+(.+)$/.exec(text);
        const count = card ? Number(card[1]) : 0;
        const name = card?.[2].trim() ?? '';
        if (!card || count < 1 || !name) {
            return text;
        }
        if ((section === 'legend' || section === 'champion') && (count !== 1 || parsed.some((line) => line.section === section))) {
            return text;
        }
        parsed.push({ section, count, name, text });
    }
    if (parsed.length === 0) {
        return source.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
    }
    return parsed;
};

const addEntry = (entries: DeckEntry[], name: string, count: number) => {
    const existing = entries.find((entry) => entry.name === name);
    if (existing) {
        existing.count += count;
        return;
    }
    entries.push({ name, count });
};

/** A deck ready to save, or the source line that did not match a card. */
export const importDecklist = async (source: string) => {
    const parsed = readLines(source);
    if (typeof parsed === 'string') {
        return parsed;
    }
    const cards = await Promise.all(parsed.map(async (line) => cardByName(line.name)));
    const failed = parsed.find((_line, index) => !cards[index]);
    if (failed) {
        return failed.text;
    }
    const deck: Omit<DeckList, 'name'> = { main: [] };
    const battlefields: DeckEntry[] = [];
    const runes: DeckEntry[] = [];
    parsed.forEach((line, index) => {
        const card = cards[index];
        if (!card) {
            return;
        }
        if (line.section === 'legend') {
            deck.legend = card.name;
        } else if (line.section === 'champion') {
            deck.champion = card.name;
        } else if (line.section === 'battlefields') {
            addEntry(battlefields, card.name, line.count);
        } else if (line.section === 'runes') {
            addEntry(runes, card.name, line.count);
        } else {
            addEntry(deck.main, card.name, line.count);
        }
    });
    if (battlefields.length > 0) {
        deck.battlefields = battlefields;
    }
    if (runes.length > 0) {
        deck.runes = runes;
    }
    return deck;
};

const importedDeckKey = 'riftatlas-imported-deck';

export const rememberImportedDeck = (name: string) => {
    sessionStorage.setItem(importedDeckKey, name);
};

export const takeImportedDeck = () => {
    const name = sessionStorage.getItem(importedDeckKey);
    if (name) {
        sessionStorage.removeItem(importedDeckKey);
    }
    return name;
};

export const saveDeckFile = async (deck: Omit<DeckList, 'name'>) => {
    const response = await fetch('/deck-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deck)
    });
    if (!response.ok) {
        return null;
    }
    const saved: unknown = await response.json();
    if (!saved || typeof saved !== 'object' || typeof (saved as DeckList).name !== 'string') {
        return null;
    }
    return saved as DeckList;
};

export const deleteDeckFile = async (name: string) => {
    await fetch('/deck-import', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
};
