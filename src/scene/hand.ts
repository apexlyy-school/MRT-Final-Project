import { Entity, Script } from 'playcanvas';

import { moveCardTo } from './cardMotion.ts';
import { addZoneLabel } from './emptySlot.ts';
import {
    PlayableCard,
    registerBattlefieldRow,
    registerRowRelayout,
    setBase,
    setHand,
    setRuneArea,
    vacateBattlefield
} from './playableCard.ts';

const cardGap = 0.08;
const stackStep = 0.006;
const borderInset = 0.05;

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
    cardDepth = 1.02;
    rune = false;
    base = false;
    /** 1 = battlefield 1 (left), 2 = battlefield 2 (right). 0 = not a battlefield row. */
    battlefield = 0;

    private zoneLabel: Entity | null = null;
    private unregisterRelayout: (() => void) | null = null;
    private unregisterBattlefield: (() => void) | null = null;

    initialize() {
        const board = this.entity.parent;
        if (board instanceof Entity && this.battlefield === 0) {
            const label = this.base ? 'Base' : this.rune ? 'Rune Area' : 'Hand';
            this.zoneLabel = addZoneLabel(board, this.app.graphicsDevice, (this.left + this.right) / 2, this.centerZ, label, `${label}-label`);
        }
        const handlers = {
            drop: (card: Entity) => this.tryDrop(card),
            draw: (card: Entity) => this.draw(card),
            release: (card: Entity) => this.release(card),
            owns: (card: Entity, x: number, z: number) => this.owns(card, x, z)
        };
        if (this.battlefield > 0) {
            this.unregisterBattlefield = registerBattlefieldRow(handlers);
        } else if (this.base) {
            setBase(handlers);
        } else if (this.rune) {
            setRuneArea(handlers);
        } else {
            setHand(handlers);
        }
        this.unregisterRelayout = registerRowRelayout((card) => {
            if (this.cards.includes(card)) {
                this.layout();
            }
        });
        this.on('destroy', () => {
            this.unregisterRelayout?.();
            this.unregisterBattlefield?.();
            if (this.battlefield === 0) {
                if (this.base) {
                    setBase(null);
                } else if (this.rune) {
                    setRuneArea(null);
                } else {
                    setHand(null);
                }
            }
            this.zoneLabel?.destroy();
        });
    }

    syncLabel() {
        if (this.zoneLabel) {
            this.zoneLabel.enabled = this.cards.length === 0;
        }
    }

    private draw(card: Entity) {
        this.remove(card);
        this.cards.push(card);
        this.seat(card);
        this.layout();
    }

    private tryDrop(card: Entity) {
        const playable = playableOn(card);
        if (!playable || playable.rune !== this.rune) {
            return false;
        }
        const position = card.getLocalPosition();
        if (!this.contains(position.x, position.z)) {
            return false;
        }
        if (this.battlefield > 0) {
            vacateBattlefield(card);
        } else {
            this.remove(card);
        }
        const slot = this.slotFor(position.x, this.cards.length + 1);
        this.cards.splice(slot, 0, card);
        this.seat(card);
        this.layout();
        return true;
    }

    private seat(card: Entity) {
        const playable = playableOn(card);
        if (this.battlefield > 0) {
            playable?.joinBattlefield(this.battlefield);
        } else if (this.base) {
            playable?.joinBase();
        } else if (this.rune) {
            playable?.joinRuneArea();
        } else {
            playable?.joinHand();
        }
    }

    private release(card: Entity) {
        if (!this.remove(card)) {
            return;
        }
        this.layout();
    }

    private owns(card: Entity, x: number, z: number) {
        let top: Entity | null = null;
        let topY = Number.NEGATIVE_INFINITY;
        for (const stacked of this.cards) {
            if (!playableOn(stacked)?.covers(x, z)) {
                continue;
            }
            const y = stacked.getLocalPosition().y;
            if (y >= topY) {
                topY = y;
                top = stacked;
            }
        }
        return top === card;
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
        const sideways = this.base || this.battlefield > 0;
        // Sideways seats and runes reserve a tapped card's width so edge cards stay inside.
        const span = sideways || this.rune ? this.cardDepth : this.cardWidth;
        const stride = sideways ? this.cardDepth : this.cardWidth;
        const inner = this.right - this.left - borderInset * 2;
        const room = (inner - span) / (count - 1);
        return Math.min(stride + cardGap, Math.max(room, 0));
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
            const playable = playableOn(card);
            if (this.battlefield > 0 || this.rune || this.base) {
                // Leftmost is layer 1 (on top). Rightmost is layer N (underneath).
                const layer = index + 1;
                if (playable) {
                    playable.layer = layer;
                }
                const y = (this.battlefield > 0 ? 0.02 : 0) + (count - layer) * stackStep;
                moveCardTo(card, x, y, this.centerZ);
                return;
            }
            if (playable) {
                playable.layer = 0;
            }
            const tapped = playable?.isTapped() ?? false;
            // Hand: untapped rightmost on top; tapped rises above cards to the right.
            const y = (tapped ? count - index : index) * stackStep;
            moveCardTo(card, x, y, this.centerZ);
        });
        this.syncLabel();
    }
}

export const addHand = (
    parent: Entity,
    left: number,
    right: number,
    centerZ: number,
    zoneDepth: number,
    cardWidth: number,
    rune = false,
    cardDepth = 1.02,
    base = false,
    battlefield = 0
) => {
    const hand = new Entity(
        battlefield > 0 ? `battlefield-${battlefield}` : base ? 'base' : rune ? 'rune-area' : 'hand'
    );
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
            cardWidth,
            cardDepth,
            rune,
            base,
            battlefield
        }
    });
};
