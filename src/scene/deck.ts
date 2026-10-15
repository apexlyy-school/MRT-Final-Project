import { Entity, Script, Vec3 } from 'playcanvas';
import type { AppBase, GraphicsDevice } from 'playcanvas';

import { cancelCardMotion, moveCardTo } from './cardMotion.ts';
import {
    createPlayableCard,
    drawToHand,
    insideRoundedCard,
    offerToHand,
    offerToTrash,
    PlayableCard,
    setDeckDrop,
    setDeckPile
} from './playableCard.ts';

const artFiles = import.meta.glob('../../card assets/*.{webp,png,jpg,jpeg}', {
    eager: true,
    import: 'default'
}) as Record<string, string>;

const clickSlop = 6;
const stackStep = 0.018;
const zonePad = 0.1;
const liftY = 0.04;
const tableY = 0.08;

const rayNear = new Vec3();
const rayFar = new Vec3();
let hitX = 0;
let hitZ = 0;

const isCardBack = (path: string) => /card\s*back/i.test(path);

const cardBackUrl = () => {
    const entry = Object.entries(artFiles).find(([path]) => isCardBack(path));
    if (!entry) {
        throw new Error('Add card back.png to the card assets folder');
    }
    return entry[1];
};

const cardArtUrls = () => Object.entries(artFiles)
    .filter(([path]) => !isCardBack(path))
    .map(([, url]) => url);

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

    cards: Entity[] = [];
    originX = 0;
    originZ = 0;
    width = 0.7;
    depth = 1.02;

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
            if (!this.returnToBottom(card) && !offerToHand(card) && !offerToTrash(card)) {
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
        drawToHand(card);
    };

    initialize() {
        setDeckDrop((card) => this.returnToBottom(card));
        setDeckPile({
            release: (card) => this.release(card),
            isTop: (card) => this.cards.length > 0 && this.cards[this.cards.length - 1] === card
        });
        window.addEventListener('pointerdown', this.onPointerDown, true);
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        this.on('destroy', () => {
            setDeckDrop(null);
            setDeckPile(null);
            if (this.holding) {
                setCameraEnabled(this.app, true);
            }
            window.removeEventListener('pointerdown', this.onPointerDown, true);
            window.removeEventListener('pointermove', this.onPointerMove);
            window.removeEventListener('pointerup', this.onPointerUp);
        });
    }

    /** Dropped on the deck zone: tuck this card under the pile, face down. */
    private returnToBottom(card: Entity) {
        const position = card.getLocalPosition();
        const overDeck = insideRoundedCard(
            position.x - this.originX,
            position.z - this.originZ,
            this.width + zonePad,
            this.depth + zonePad
        );
        if (!overDeck) {
            return false;
        }
        const index = this.cards.indexOf(card);
        if (index >= 0) {
            this.cards.splice(index, 1);
        }
        this.cards.unshift(card);
        this.cards.forEach((stacked, stackedIndex) => {
            moveCardTo(stacked, this.originX, stackedIndex * stackStep, this.originZ);
        });
        const playable = card.script?.get('playableCard');
        if (playable instanceof PlayableCard) {
            playable.joinDeck();
        }
        return true;
    }

    private release(card: Entity) {
        const index = this.cards.indexOf(card);
        if (index < 0) {
            return;
        }
        this.cards.splice(index, 1);
        this.cards.forEach((stacked, stackedIndex) => {
            moveCardTo(stacked, this.originX, stackedIndex * stackStep, this.originZ);
        });
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

export const addDeck = (
    parent: Entity,
    device: GraphicsDevice,
    x: number,
    z: number,
    width: number,
    depth: number
) => {
    const back = cardBackUrl();
    const cards = shuffle(cardArtUrls()).map((art, index) => {
        const card = createPlayableCard(parent, device, x, z, width, depth, art, back, true);
        card.setLocalPosition(x, index * stackStep, z);
        return card;
    });

    const deck = new Entity('deck');
    parent.addChild(deck);
    const scripts = deck.addComponent('script');
    if (!scripts) {
        throw new Error('Failed to create the deck');
    }
    scripts.create(CardDeck, {
        properties: {
            cards,
            originX: x,
            originZ: z,
            width,
            depth
        }
    });
};
