import { Entity, Script, Vec3 } from 'playcanvas';
import type { AppBase } from 'playcanvas';

import { resolveDeck } from './cardCatalog.ts';
import type { DeckList } from './cardCatalog.ts';
import { cancelCardMotion, moveCardTo } from './cardMotion.ts';
import { CardHand } from './hand.ts';
import {
    createPlayableCard,
    drawToHand,
    drawToRuneArea,
    insideRoundedCard,
    offerToHand,
    offerToRuneArea,
    offerToTrash,
    PlayableCard,
    setDeckDrop,
    setDeckPile
} from './playableCard.ts';
import { CardTrash } from './trash.ts';

const clickSlop = 6;
const stackStep = 0.018;
const zonePad = 0.1;
const liftY = 0.04;
const tableY = 0.08;

const rayNear = new Vec3();
const rayFar = new Vec3();
let hitX = 0;
let hitZ = 0;

const shuffle = (urls: string[]) => {
    const order = [...urls];
    for (let i = order.length - 1; i > 0; i--) {
        const swap = Math.floor(Math.random() * (i + 1));
        const current = order[i];
        order[i] = order[swap];
        order[swap] = current;
    }
    return order;
};

const setCameraEnabled = (app: AppBase, enabled: boolean) => {
    const camera = app.root.findByName('camera');
    if (!(camera instanceof Entity) || !camera.script) {
        return;
    }
    const controls = camera.script.get('cameraControls');
    if (controls) {
        controls.enabled = enabled;
    }
};

export class CardDeck extends Script {
    static scriptName = 'cardDeck';

    private static readonly piles: CardDeck[] = [];

    cards: Entity[] = [];
    originX = 0;
    originZ = 0;
    width = 0.7;
    depth = 1.02;
    rune = false;

    private holding: Entity | null = null;
    private dragging = false;
    private pointerStart = { x: 0, y: 0 };
    private grabX = 0;
    private grabZ = 0;

    private readonly onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || this.holding || this.cards.length === 0 || !this.rayTable(event)) {
            return;
        }
        if (!insideRoundedCard(hitX - this.originX, hitZ - this.originZ, this.width, this.depth)) {
            return;
        }
        event.stopPropagation();
        const top = this.cards[this.cards.length - 1];
        const position = top.getPosition();
        this.holding = top;
        this.dragging = false;
        this.pointerStart.x = event.clientX;
        this.pointerStart.y = event.clientY;
        this.grabX = hitX - position.x;
        this.grabZ = hitZ - position.z;
        setCameraEnabled(this.app, false);
    };

    private readonly onPointerMove = (event: PointerEvent) => {
        const card = this.holding;
        if (!card) {
            return;
        }
        const dx = event.clientX - this.pointerStart.x;
        const dy = event.clientY - this.pointerStart.y;
        if (!this.dragging && dx * dx + dy * dy > clickSlop * clickSlop) {
            this.dragging = true;
            this.take(card, false);
        }
        if (!this.dragging || !this.rayTable(event)) {
            return;
        }
        cancelCardMotion(card);
        card.setLocalPosition(hitX - this.grabX, liftY, hitZ - this.grabZ);
    };

    private readonly onPointerUp = (event: PointerEvent) => {
        const card = this.holding;
        if (!card || event.button !== 0) {
            return;
        }
        event.stopPropagation();
        this.holding = null;
        setCameraEnabled(this.app, true);
        if (this.dragging) {
            const placed = this.rune
                ? this.tryDrop(card) || offerToRuneArea(card)
                : this.tryDrop(card) || offerToHand(card) || offerToTrash(card);
            if (!placed) {
                const position = card.getLocalPosition();
                card.setLocalPosition(position.x, 0, position.z);
                const playable = card.script?.get('playableCard');
                if (playable instanceof PlayableCard) {
                    playable.setFaceUp(true);
                }
            }
            return;
        }
        this.take(card, true);
        if (this.rune) {
            drawToRuneArea(card);
        } else {
            drawToHand(card);
        }
    };

    initialize() {
        CardDeck.piles.push(this);
        CardDeck.sync();
        window.addEventListener('pointerdown', this.onPointerDown, true);
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        this.on('destroy', () => {
            const index = CardDeck.piles.indexOf(this);
            if (index >= 0) {
                CardDeck.piles.splice(index, 1);
            }
            if (CardDeck.piles.length === 0) {
                setDeckDrop(null);
                setDeckPile(null);
            } else {
                CardDeck.sync();
            }
            if (this.holding) {
                setCameraEnabled(this.app, true);
            }
            window.removeEventListener('pointerdown', this.onPointerDown, true);
            window.removeEventListener('pointermove', this.onPointerMove);
            window.removeEventListener('pointerup', this.onPointerUp);
        });
    }

    /** Dropped on this pile's zone: tuck the matching card under the pile, face down. */
    tryDrop(card: Entity) {
        if (!this.matches(card) || !this.overZone(card)) {
            return false;
        }
        return this.bury(card);
    }

    /** Right-click: the matching rune goes under this pile even from across the table. */
    bury(card: Entity) {
        if (!this.matches(card)) {
            return false;
        }
        const index = this.cards.indexOf(card);
        if (index >= 0) {
            this.cards.splice(index, 1);
        }
        this.cards.unshift(card);
        this.restack();
        const playable = card.script?.get('playableCard');
        if (playable instanceof PlayableCard) {
            playable.joinDeck();
        }
        return true;
    }

    load(list: DeckList) {
        const board = this.entity.parent;
        const resolved = board instanceof Entity ? resolveDeck(list) : null;
        setCameraEnabled(this.app, true);
        this.clearPlay();
        if (!resolved || !(board instanceof Entity)) {
            return;
        }
        const mainPile = CardDeck.piles.find((pile) => !pile.rune);
        const runePile = CardDeck.piles.find((pile) => pile.rune);
        mainPile?.fill(resolved.copies, resolved.back);
        runePile?.fill(resolved.runes, resolved.runeBack);
    }

    fill(arts: string[], back: string) {
        const board = this.entity.parent;
        if (!(board instanceof Entity) || arts.length === 0 || !back) {
            this.cards = [];
            return;
        }
        this.cards = shuffle(arts).map((art, index) => {
            const card = createPlayableCard(
                board,
                this.app.graphicsDevice,
                this.originX,
                this.originZ,
                this.width,
                this.depth,
                art,
                back,
                true,
                this.rune
            );
            card.setLocalPosition(this.originX, index * stackStep, this.originZ);
            return card;
        });
    }

    private static sync() {
        setDeckDrop((card) => CardDeck.piles.some((pile) => pile.tryDrop(card)));
        setDeckPile({
            release: (card) => {
                for (const pile of CardDeck.piles) {
                    pile.release(card);
                }
            },
            isTop: (card) => CardDeck.piles.some((pile) => pile.cards.length > 0 && pile.cards[pile.cards.length - 1] === card),
            bury: (card) => CardDeck.piles.some((pile) => pile.bury(card))
        });
    }

    private clearPlay() {
        const hand = this.zoneScript('hand', 'cardHand');
        const runes = this.zoneScript('rune-area', 'cardHand');
        const trash = this.zoneScript('trash', 'cardTrash');
        if (hand instanceof CardHand) {
            hand.cards.length = 0;
        }
        if (runes instanceof CardHand) {
            runes.cards.length = 0;
        }
        if (trash instanceof CardTrash) {
            trash.cards.length = 0;
        }
        for (const pile of CardDeck.piles) {
            pile.holding = null;
            pile.dragging = false;
            pile.cards.length = 0;
        }
        const board = this.entity.parent;
        if (!board) {
            return;
        }
        for (const child of [...board.children]) {
            if (child.name !== 'card' || !(child instanceof Entity)) {
                continue;
            }
            cancelCardMotion(child);
            child.destroy();
        }
    }

    private zoneScript(entityName: string, scriptName: string) {
        const board = this.entity.parent;
        if (!board) {
            return null;
        }
        for (const child of board.children) {
            if (child.name !== entityName || !(child instanceof Entity)) {
                continue;
            }
            const script = child.script?.get(scriptName);
            if (script) {
                return script;
            }
        }
        return null;
    }

    private matches(card: Entity) {
        const playable = card.script?.get('playableCard');
        return playable instanceof PlayableCard && playable.rune === this.rune;
    }

    private overZone(card: Entity) {
        const position = card.getLocalPosition();
        return insideRoundedCard(
            position.x - this.originX,
            position.z - this.originZ,
            this.width + zonePad,
            this.depth + zonePad
        );
    }

    private restack() {
        this.cards.forEach((stacked, stackedIndex) => {
            moveCardTo(stacked, this.originX, stackedIndex * stackStep, this.originZ);
        });
    }

    private release(card: Entity) {
        const index = this.cards.indexOf(card);
        if (index < 0) {
            return;
        }
        this.cards.splice(index, 1);
        this.restack();
    }

    private take(card: Entity, faceUp: boolean) {
        const index = this.cards.indexOf(card);
        if (index >= 0) {
            this.cards.splice(index, 1);
        }
        const playable = card.script?.get('playableCard');
        if (playable instanceof PlayableCard) {
            playable.inDeck = false;
            if (faceUp) {
                playable.setFaceUp(true);
            }
        }
    }

    private rayTable(event: PointerEvent) {
        const cameraNode = this.app.root.findByName('camera');
        const camera = cameraNode instanceof Entity ? cameraNode.camera : null;
        const canvas = this.app.graphicsDevice.canvas;
        if (!camera || !(canvas instanceof HTMLCanvasElement)) {
            return false;
        }
        const rect = canvas.getBoundingClientRect();
        camera.screenToWorld(event.clientX - rect.left, event.clientY - rect.top, camera.nearClip, rayNear);
        camera.screenToWorld(event.clientX - rect.left, event.clientY - rect.top, camera.farClip, rayFar);
        const dy = rayFar.y - rayNear.y;
        if (Math.abs(dy) < 1e-5) {
            return false;
        }
        const t = (tableY - rayNear.y) / dy;
        if (t < 0 || t > 1) {
            return false;
        }
        hitX = rayNear.x + (rayFar.x - rayNear.x) * t;
        hitZ = rayNear.z + (rayFar.z - rayNear.z) * t;
        return true;
    }
}

export const addDeck = (parent: Entity, x: number, z: number, width: number, depth: number, rune = false) => {
    const deckEntity = new Entity(rune ? 'rune-deck' : 'deck');
    parent.addChild(deckEntity);
    const scripts = deckEntity.addComponent('script');
    if (!scripts) {
        throw new Error('Failed to create the deck');
    }
    const deck = scripts.create(CardDeck, {
        properties: {
            originX: x,
            originZ: z,
            width,
            depth,
            rune
        }
    });
    if (!deck) {
        throw new Error('Failed to create the deck');
    }
    return deck;
};
