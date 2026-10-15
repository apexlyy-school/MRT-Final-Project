import { Entity, Script } from 'playcanvas';

import { moveCardTo } from './cardMotion.ts';
import { addEmptySlot } from './emptySlot.ts';
import { createPlayableCard, insideRoundedCard, PlayableCard, setChampionZone } from './playableCard.ts';

const zonePad = 0.1;

const playableOn = (card: Entity) => {
    const playable = card.script?.get('playableCard');
    return playable instanceof PlayableCard ? playable : null;
};

export class CardChampion extends Script {
    static scriptName = 'cardChampion';

    card: Entity | null = null;
    originX = 0;
    originZ = 0;
    width = 0.7;
    depth = 1.02;

    private mark: Entity | null = null;

    initialize() {
        const board = this.entity.parent;
        if (board instanceof Entity) {
            this.mark = addEmptySlot(
                board,
                this.app.graphicsDevice,
                this.originX,
                this.originZ,
                this.width,
                this.depth,
                'Chosen Champion',
                'chosen-champion-empty'
            );
            this.refreshMark();
        }
        setChampionZone({
            drop: (card) => this.tryDrop(card),
            release: (card) => this.release(card)
        });
        this.on('destroy', () => {
            setChampionZone(null);
            this.mark?.destroy();
        });
    }

    /** Deal the deck's champion into this slot, face up. */
    place(art: string, back: string) {
        const board = this.entity.parent;
        if (!(board instanceof Entity)) {
            this.card = null;
            this.refreshMark();
            return;
        }
        const card = createPlayableCard(
            board,
            this.app.graphicsDevice,
            this.originX,
            this.originZ,
            this.width,
            this.depth,
            art,
            back,
            false,
            false,
            false,
            true
        );
        this.card = card;
        playableOn(card)?.joinChampion();
        this.refreshMark();
    }

    clear() {
        this.card = null;
        this.refreshMark();
    }

    private tryDrop(card: Entity) {
        const playable = playableOn(card);
        if (!playable?.champion) {
            return false;
        }
        const position = card.getLocalPosition();
        if (!insideRoundedCard(position.x - this.originX, position.z - this.originZ, this.width + zonePad, this.depth + zonePad)) {
            return false;
        }
        this.card = card;
        moveCardTo(card, this.originX, 0, this.originZ);
        playable.joinChampion();
        this.refreshMark();
        return true;
    }

    private release(card: Entity) {
        if (this.card !== card) {
            return;
        }
        this.card = null;
        this.refreshMark();
    }

    private refreshMark() {
        if (this.mark) {
            this.mark.enabled = this.card === null;
        }
    }
}

export const addChampion = (parent: Entity, x: number, z: number, width: number, depth: number) => {
    const champion = new Entity('chosen-champion');
    parent.addChild(champion);
    const scripts = champion.addComponent('script');
    if (!scripts) {
        throw new Error('Failed to create the chosen champion');
    }
    scripts.create(CardChampion, {
        properties: {
            originX: x,
            originZ: z,
            width,
            depth
        }
    });
};
