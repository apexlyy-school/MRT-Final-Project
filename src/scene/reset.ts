import { Entity } from 'playcanvas';
import type { GraphicsDevice } from 'playcanvas';

import { CardDeck } from './deck.ts';
import { ScoreTrack } from './scoreTrack.ts';
import { addTableButton } from './tableButton.ts';

/** Reshuffle the active deck and clear score — shared by Reset and the tutorial. */
export const resetMatch = (
    board: Entity,
    options?: { autoBattlefield?: boolean; openingDraw?: boolean }
) => {
    const deckNode = board.findByName('deck');
    const deck = deckNode instanceof Entity ? deckNode.script?.get('cardDeck') : null;
    if (deck instanceof CardDeck) {
        deck.reload(options);
    }
    const trackNode = board.findByName('score-track');
    const track = trackNode instanceof Entity ? trackNode.script?.get('scoreTrack') : null;
    if (track instanceof ScoreTrack) {
        track.reset();
    }
};

export const addReset = (
    parent: Entity,
    device: GraphicsDevice,
    x: number,
    z: number,
    width = 1.15,
    depth = 0.4
) => {
    addTableButton(parent, device, x, z, 'RESET', 'reset', () => {
        resetMatch(parent);
    }, width, depth);
};
