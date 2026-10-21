import { Entity } from 'playcanvas';
import type { GraphicsDevice } from 'playcanvas';

import { CardDeck } from './deck.ts';
import { CardHand } from './hand.ts';
import { PlayableCard } from './playableCard.ts';
import { ScoreTrack } from './scoreTrack.ts';
import { addTableButton } from './tableButton.ts';

const zoneHand = (board: Entity, name: string) => {
    const zone = board.findByName(name);
    if (!(zone instanceof Entity) || !zone.script) {
        return null;
    }
    const hand = zone.script.get('cardHand');
    return hand instanceof CardHand ? hand : null;
};

const pile = (board: Entity, name: string) => {
    const zone = board.findByName(name);
    if (!(zone instanceof Entity) || !zone.script) {
        return null;
    }
    const deck = zone.script.get('cardDeck');
    return deck instanceof CardDeck ? deck : null;
};

const scoreTrack = (board: Entity) => {
    const track = board.findByName('score-track');
    if (!(track instanceof Entity) || !track.script) {
        return null;
    }
    const score = track.script.get('scoreTrack');
    return score instanceof ScoreTrack ? score : null;
};

const untapSeated = (board: Entity) => {
    for (const child of board.children) {
        if (!(child instanceof Entity) || !child.script) {
            continue;
        }
        const playable = child.script.get('playableCard');
        if (!(playable instanceof PlayableCard)) {
            continue;
        }
        if (playable.inDeck || playable.inTrash || playable.pinned) {
            continue;
        }
        playable.untap();
    }
};

const endTurnEffects = (board: Entity) => {
    untapSeated(board);

    const runeDeck = pile(board, 'rune-deck');
    runeDeck?.drawTop();
    runeDeck?.drawTop();

    pile(board, 'deck')?.drawTop();

    let points = 0;
    if ((zoneHand(board, 'battlefield-1')?.cards.length ?? 0) > 0) {
        points += 1;
    }
    if ((zoneHand(board, 'battlefield-2')?.cards.length ?? 0) > 0) {
        points += 1;
    }
    if (points > 0) {
        scoreTrack(board)?.gain(points);
    }
};

export const addEndTurn = (
    parent: Entity,
    device: GraphicsDevice,
    x: number,
    z: number,
    width = 1.15,
    depth = 0.4
) => {
    addTableButton(parent, device, x, z, 'END TURN', 'end-turn', () => {
        endTurnEffects(parent);
    }, width, depth);
};
