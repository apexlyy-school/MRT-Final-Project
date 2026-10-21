import { Entity, Script, Vec3 } from 'playcanvas';
import type { AppBase } from 'playcanvas';

import { clearBattlefieldChooser, presentBattlefieldChoices, showPlayerBattlefield } from './battlefield.ts';
import { resolveDeck } from './cardCatalog.ts';
import type { DeckList } from './cardCatalog.ts';
import { cancelCardMotion, moveCardTo } from './cardMotion.ts';
import { CardChampion } from './champion.ts';
import { addEmptySlot, addZoneLabel } from './emptySlot.ts';
import { CardHand } from './hand.ts';
import {
    createPlayableCard,
    drawToHand,
    drawToRuneArea,
    insideRoundedCard,
    offerToBase,
    offerToChampion,
    offerToHand,
    offerToRuneArea,
    offerToTrash,
    offerToBattlefield,
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
    anchorLegend = false;
    legendZ = 0;

    private legendMark: Entity | null = null;
    private zoneLabel: Entity | null = null;

    private loadToken = 0;
    private currentList: DeckList | null = null;
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
                : this.tryDrop(card) || offerToChampion(card) || offerToBattlefield(card) || offerToBase(card) || offerToHand(card) || offerToTrash(card);
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
        const board = this.entity.parent;
        if (board instanceof Entity) {
            const label = this.rune ? 'Rune Deck' : 'Deck';
            this.zoneLabel = addZoneLabel(board, this.app.graphicsDevice, this.originX, this.originZ, label, `${label}-label`);
        }
        if (this.anchorLegend && board instanceof Entity) {
            this.legendMark = addEmptySlot(
                board,
                this.app.graphicsDevice,
                this.originX,
                this.legendZ,
                this.width,
                this.depth,
                'Chosen Legend',
                'chosen-legend-empty'
            );
        }
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
            this.legendMark?.destroy();
            this.zoneLabel?.destroy();
        });
    }

    syncLabel() {
        if (this.zoneLabel) {
            this.zoneLabel.enabled = this.cards.length === 0;
        }
    }

    /** Draw the top card into the hand or rune area. Returns false when the pile is empty. */
    drawTop() {
        if (this.cards.length === 0) {
            return false;
        }
        const card = this.cards[this.cards.length - 1];
        this.take(card, true);
        if (this.rune) {
            drawToRuneArea(card);
        } else {
            drawToHand(card);
        }
        return true;
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
        this.syncLabel();
        return true;
    }

    load(list: DeckList) {
        this.currentList = list;
        const token = ++this.loadToken;
        setCameraEnabled(this.app, true);
        clearBattlefieldChooser();
        this.clearPlay();
        void this.deal(list, token);
    }

    /** Reload the active list: reshuffle piles, reseat identity cards, and reopen battlefield choice. */
    reload() {
        if (!this.currentList) {
            return;
        }
        this.load(this.currentList);
    }

    private async deal(list: DeckList, token: number) {
        const resolved = await resolveDeck(list);
        if (token !== this.loadToken) {
            return;
        }
        if (!resolved) {
            clearBattlefieldChooser();
            showPlayerBattlefield(null);
            return;
        }
        const mainPile = CardDeck.piles.find((pile) => !pile.rune);
        const runePile = CardDeck.piles.find((pile) => pile.rune);
        mainPile?.fill(resolved.copies, resolved.back);
        runePile?.fill(resolved.runes, resolved.runeBack);
        if (resolved.legend) {
            mainPile?.placeLegend(resolved.legend.art, resolved.legend.back);
        }
        const championZone = this.zoneScript('chosen-champion', 'cardChampion');
        if (resolved.champion && championZone instanceof CardChampion) {
            championZone.place(resolved.champion.art, resolved.champion.back);
        }
        clearBattlefieldChooser();
        showPlayerBattlefield(null);
        presentBattlefieldChoices(resolved.battlefields);
    }

    placeLegend(art: string, back: string) {
        const board = this.entity.parent;
        if (!this.anchorLegend || !(board instanceof Entity)) {
            return;
        }
        const card = createPlayableCard(
            board,
            this.app.graphicsDevice,
            this.originX,
            this.legendZ,
            this.width,
            this.depth,
            art,
            back,
            false,
            false,
            true
        );
        const playable = card.script?.get('playableCard');
        if (playable instanceof PlayableCard) {
            playable.setFaceUp(true);
        }
        if (this.legendMark) {
            this.legendMark.enabled = false;
        }
    }

    fill(arts: string[], back: string) {
        const board = this.entity.parent;
        if (!(board instanceof Entity) || arts.length === 0 || !back) {
            this.cards = [];
            this.syncLabel();
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
        this.syncLabel();
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
        const base = this.zoneScript('base', 'cardHand');
        const battlefield1 = this.zoneScript('battlefield-1', 'cardHand');
        const battlefield2 = this.zoneScript('battlefield-2', 'cardHand');
        const trash = this.zoneScript('trash', 'cardTrash');
        const champion = this.zoneScript('chosen-champion', 'cardChampion');
        if (hand instanceof CardHand) {
            hand.cards.length = 0;
            hand.syncLabel();
        }
        if (runes instanceof CardHand) {
            runes.cards.length = 0;
            runes.syncLabel();
        }
        if (base instanceof CardHand) {
            base.cards.length = 0;
            base.syncLabel();
        }
        if (battlefield1 instanceof CardHand) {
            battlefield1.cards.length = 0;
            battlefield1.syncLabel();
        }
        if (battlefield2 instanceof CardHand) {
            battlefield2.cards.length = 0;
            battlefield2.syncLabel();
        }
        if (trash instanceof CardTrash) {
            trash.cards.length = 0;
            trash.syncLabel();
        }
        if (champion instanceof CardChampion) {
            champion.clear();
        }
        if (this.legendMark) {
            this.legendMark.enabled = true;
        }
        for (const pile of CardDeck.piles) {
            pile.holding = null;
            pile.dragging = false;
            pile.cards.length = 0;
            pile.syncLabel();
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
        this.syncLabel();
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
        this.syncLabel();
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

export const addDeck = (
    parent: Entity,
    x: number,
    z: number,
    width: number,
    depth: number,
    rune = false,
    legendZ?: number
) => {
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
            rune,
            anchorLegend: legendZ !== undefined,
            legendZ: legendZ ?? 0
        }
    });
    if (!deck) {
        throw new Error('Failed to create the deck');
    }
    return deck;
};
