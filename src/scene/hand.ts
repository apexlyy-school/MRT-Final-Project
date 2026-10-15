import { Entity, Script } from 'playcanvas';

import { PlayableCard, setHand } from './playableCard.ts';

const cardGap = 0.08;
const stackStep = 0.006;

const playableOn = (card: Entity) => {
    const playable = card.script?.get('playableCard');
    return playable instanceof PlayableCard ? playable : null;
};

export class CardHand extends Script {
    static scriptName = 'cardHand';

    cards: Entity[] = [];
    left = 0;
    right = 0;
    centerZ = 0;
    zoneDepth = 1.12;
    cardWidth = 0.7;

    initialize() {
        setHand({
            drop: (card) => this.tryDrop(card),
            draw: (card) => this.draw(card),
            release: (card) => this.release(card),
            owns: (card, x, z) => this.owns(card, x, z)
        });
        this.on('destroy', () => {
            setHand(null);
        });
    }

    private draw(card: Entity) {
        this.remove(card);
        this.cards.push(card);
        this.layout();
        playableOn(card)?.joinHand();
    }

    private tryDrop(card: Entity) {
        const position = card.getLocalPosition();
        if (!this.contains(position.x, position.z)) {
            return false;
        }
        this.remove(card);
        const slot = this.slotFor(position.x, this.cards.length + 1);
        this.cards.splice(slot, 0, card);
        this.layout();
        playableOn(card)?.joinHand();
        return true;
    }

    private release(card: Entity) {
        if (!this.remove(card)) {
            return;
        }
        this.layout();
    }

    private owns(card: Entity, x: number, z: number) {
        for (let i = this.cards.length - 1; i >= 0; i--) {
            const stacked = this.cards[i];
            if (!playableOn(stacked)?.covers(x, z)) {
                continue;
            }
            return stacked === card;
        }
        return false;
    }

    private remove(card: Entity) {
        const index = this.cards.indexOf(card);
        if (index < 0) {
            return false;
        }
        this.cards.splice(index, 1);
        return true;
    }

    private contains(x: number, z: number) {
        const halfDepth = this.zoneDepth / 2;
        return x >= this.left && x <= this.right && z >= this.centerZ - halfDepth && z <= this.centerZ + halfDepth;
    }

    private pitch(count: number) {
        if (count <= 1) {
            return 0;
        }
        const room = (this.right - this.left - this.cardWidth) / (count - 1);
        return Math.min(this.cardWidth + cardGap, Math.max(room, 0));
    }

    private slotFor(x: number, count: number) {
        const step = this.pitch(count);
        const mid = (this.left + this.right) / 2;
        let slot = 0;
        let nearest = Number.POSITIVE_INFINITY;
        for (let i = 0; i < count; i++) {
            const distance = Math.abs(x - (mid + (i - (count - 1) / 2) * step));
            if (distance < nearest) {
                nearest = distance;
                slot = i;
            }
        }
        return slot;
    }

    private layout() {
        const count = this.cards.length;
        const step = this.pitch(count);
        const mid = (this.left + this.right) / 2;
        this.cards.forEach((card, index) => {
            const x = mid + (index - (count - 1) / 2) * step;
            card.setLocalPosition(x, index * stackStep, this.centerZ);
            card.setLocalEulerAngles(0, 0, 0);
        });
    }
}

export const addHand = (
    parent: Entity,
    left: number,
    right: number,
    centerZ: number,
    zoneDepth: number,
    cardWidth: number
) => {
    const hand = new Entity('hand');
    parent.addChild(hand);
    const scripts = hand.addComponent('script');
    if (!scripts) {
        throw new Error('Failed to create the hand');
    }
    scripts.create(CardHand, {
        properties: {
            left,
            right,
            centerZ,
            zoneDepth,
            cardWidth
        }
    });
};
