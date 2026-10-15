import type { DeckList } from './cardCatalog.ts';
import type { CardDeck } from './deck.ts';

export const mountDeckPicker = (deck: CardDeck, lists: DeckList[], active: DeckList) => {
    const label = document.createElement('label');
    label.className = 'deck-picker';
    label.textContent = 'Deck';

    const select = document.createElement('select');
    for (const list of lists) {
        const option = document.createElement('option');
        option.value = list.name;
        option.textContent = list.name;
        select.appendChild(option);
    }
    select.value = active.name;
    select.addEventListener('change', () => {
        const list = lists.find((entry) => entry.name === select.value);
        if (list) {
            deck.load(list);
        }
    });

    label.appendChild(select);
    document.body.appendChild(label);
};
