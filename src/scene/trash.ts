import { Entity, Script, Vec3 } from 'playcanvas';
import type { AppBase } from 'playcanvas';

import { cancelCardMotion, moveCardTo } from './cardMotion.ts';
import { insideRoundedCard, offerToDeck, offerToHand, PlayableCard, setTrash } from './playableCard.ts';

const clickSlop = 6;
const stackStep = 0.018;
const zonePad = 0.1;
const liftY = 0.04;
const tableY = 0.08;

const rayNear = new Vec3();
const rayFar = new Vec3();
let hitX = 0;
let hitZ = 0;

const playableOn = (card: Entity) => {
    const playable = card.script?.get('playableCard');
    return playable instanceof PlayableCard ? playable : null;
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

export class CardTrash extends Script {
    static scriptName = 'cardTrash';

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
        if (!this.overZone(hitX, hitZ)) {
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
            this.release(card);
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
        if (!this.dragging) {
            return;
        }
        if (!offerToDeck(card) && !offerToHand(card) && !this.tryDrop(card)) {
            const position = card.getLocalPosition();
            card.setLocalPosition(position.x, 0, position.z);
        }
    };

    private readonly onContextMenu = (event: Event) => {
        if (event.target instanceof Element && event.target.closest('canvas')) {
            event.preventDefault();
        }
    };

    initialize() {
        setTrash({
            drop: (card) => this.tryDrop(card),
            send: (card) => {
                this.receive(card);
            },
            release: (card) => this.release(card)
        });
        window.addEventListener('pointerdown', this.onPointerDown, true);
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        window.addEventListener('contextmenu', this.onContextMenu);
        this.on('destroy', () => {
            setTrash(null);
            if (this.holding) {
                setCameraEnabled(this.app, true);
            }
            window.removeEventListener('pointerdown', this.onPointerDown, true);
            window.removeEventListener('pointermove', this.onPointerMove);
            window.removeEventListener('pointerup', this.onPointerUp);
            window.removeEventListener('contextmenu', this.onContextMenu);
        });
    }

    private tryDrop(card: Entity) {
        const playable = card.script?.get('playableCard');
        if (playable instanceof PlayableCard && playable.rune) {
            return false;
        }
        const position = card.getLocalPosition();
        if (!this.overZone(position.x, position.z)) {
            return false;
        }
        this.receive(card);
        return true;
    }

    private receive(card: Entity) {
        this.remove(card);
        this.cards.push(card);
        this.layout();
        playableOn(card)?.joinTrash();
        return true;
    }

    private release(card: Entity) {
        const playable = playableOn(card);
        if (playable) {
            playable.inTrash = false;
        }
        if (!this.remove(card)) {
            return;
        }
        this.layout();
    }

    private remove(card: Entity) {
        const index = this.cards.indexOf(card);
        if (index < 0) {
            return false;
        }
        this.cards.splice(index, 1);
        return true;
    }

    private layout() {
        this.cards.forEach((card, index) => {
            moveCardTo(card, this.originX, index * stackStep, this.originZ);
        });
    }

    private overZone(x: number, z: number) {
        return insideRoundedCard(x - this.originX, z - this.originZ, this.width + zonePad, this.depth + zonePad);
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

export const addTrash = (parent: Entity, x: number, z: number, width: number, depth: number) => {
    const trash = new Entity('trash');
    parent.addChild(trash);
    const scripts = trash.addComponent('script');
    if (!scripts) {
        throw new Error('Failed to create the trash');
    }
    scripts.create(CardTrash, {
        properties: {
            originX: x,
            originZ: z,
            width,
            depth
        }
    });
};
