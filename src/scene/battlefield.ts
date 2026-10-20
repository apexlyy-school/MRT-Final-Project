import {
    ADDRESS_CLAMP_TO_EDGE,
    BLEND_NORMAL,
    Entity,
    FILTER_LINEAR,
    FILTER_LINEAR_MIPMAP_LINEAR,
    Mat4,
    Mesh,
    MeshInstance,
    PIXELFORMAT_RGBA8,
    PlaneGeometry,
    Script,
    StandardMaterial,
    Texture,
    Vec2,
    Vec3
} from 'playcanvas';
import type { AppBase, GraphicsDevice } from 'playcanvas';

import { cancelCardMotion, moveCardTo } from './cardMotion.ts';
import { createDoubleSidedCard, createStaticCard, insideRoundedCard } from './playableCard.ts';

type BattlefieldSeat = {
    board: Entity;
    device: GraphicsDevice;
    x: number;
    z: number;
    width: number;
    depth: number;
    blankUrl: string;
    label: Entity | null;
    card: Entity | null;
};

let player: BattlefieldSeat | null = null;
let chooser: Entity | null = null;
let settling = false;
let settlingCard: Entity | null = null;

const clickSlop = 6;
const choiceGap = 0.14;
/** Hover just above the blank seat so the row reads as a flat projection. */
const choiceLift = 0.22;
const labelLift = 0.38;
const settleDuration = 0.45;
const seatY = 0;
/** Stop just above the seat so the settling card never z-fights the replacement. */
const settleStopY = seatY + 0.04;
const rayNear = new Vec3();
const rayFar = new Vec3();
const hitPoint = new Vec3();
const rayDir = new Vec3();
const localHit = new Vec3();
const inverse = new Mat4();

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

/**
 * Landscape battlefield card. Riftcodex battlefield art is already sideways, so the mesh is
 * wide on X and short on Z with no yaw. Portrait blank backs are rotated to match.
 */
export const addBattlefield = (
    parent: Entity,
    device: GraphicsDevice,
    x: number,
    z: number,
    width: number,
    depth: number,
    artUrl: string,
    name: string,
    blank = false
) => {
    return createStaticCard(parent, device, x, z, width, depth, artUrl, name, blank);
};

/** The player's battlefield seat. Starts on the blank back and updates when a deck loads. */
export const mountPlayerBattlefield = (
    board: Entity,
    device: GraphicsDevice,
    x: number,
    z: number,
    width: number,
    depth: number,
    blankUrl: string,
    label: Entity | null
) => {
    player = {
        board,
        device,
        x,
        z,
        width,
        depth,
        blankUrl,
        label,
        card: null
    };
    showPlayerBattlefield(null);
};

/** Show a chosen battlefield face, or the blank back when art is missing. */
export const showPlayerBattlefield = (artUrl: string | null) => {
    if (!player) {
        return;
    }
    const blank = !artUrl;
    player.card?.destroy();
    player.card = addBattlefield(
        player.board,
        player.device,
        player.x,
        player.z,
        player.width,
        player.depth,
        artUrl ?? player.blankUrl,
        'battlefield-1-art',
        blank
    );
    if (player.label) {
        player.label.enabled = false;
    }
};

/** Remove any open battlefield picker. */
export const clearBattlefieldChooser = () => {
    if (settlingCard) {
        cancelCardMotion(settlingCard);
        settlingCard.destroy();
        settlingCard = null;
    }
    chooser?.destroy();
    chooser = null;
    settling = false;
};

/** Float the tapped choice down onto the blank seat, then lock it in. */
const settleBattlefieldChoice = (card: Entity, artUrl: string) => {
    if (!player || settling) {
        return;
    }
    settling = true;
    settlingCard = card;

    const world = card.getPosition().clone();
    player.board.addChild(card);
    card.setLocalPosition(world.x, world.y, world.z);

    // Drop the rest of the projection immediately; keep only the settling card.
    chooser?.destroy();
    chooser = null;

    const { x, z } = player;
    moveCardTo(card, x, settleStopY, z, {
        duration: settleDuration,
        onComplete: () => {
            if (settlingCard !== card) {
                return;
            }
            // Remove the floater first, then seat the permanent card.
            card.destroy();
            settlingCard = null;
            settling = false;
            showPlayerBattlefield(artUrl);
        }
    });
};

const addChooserLabel = (
    parent: Entity,
    device: GraphicsDevice,
    x: number,
    y: number,
    z: number
) => {
    const text = 'Choose a battlefield';
    const fontPx = 128;
    const scratch = document.createElement('canvas').getContext('2d');
    if (!scratch) {
        throw new Error('Failed to draw the battlefield chooser label');
    }
    scratch.font = `700 ${fontPx}px Arial, Helvetica, sans-serif`;
    const measured = scratch.measureText(text);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(4, Math.ceil(measured.width + fontPx));
    canvas.height = Math.ceil(fontPx * 1.4);
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Failed to draw the battlefield chooser label');
    }
    context.font = `700 ${fontPx}px Arial, Helvetica, sans-serif`;
    context.fillStyle = '#e4edf6';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new Texture(device, {
        name: 'battlefield-choose-label',
        width: canvas.width,
        height: canvas.height,
        format: PIXELFORMAT_RGBA8,
        mipmaps: true,
        minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
        magFilter: FILTER_LINEAR,
        addressU: ADDRESS_CLAMP_TO_EDGE,
        addressV: ADDRESS_CLAMP_TO_EDGE
    });
    texture.setSource(canvas);
    const material = new StandardMaterial();
    material.diffuseMap = texture;
    material.opacityMap = texture;
    material.opacityMapChannel = 'a';
    material.blendType = BLEND_NORMAL;
    material.useLighting = false;
    material.depthWrite = false;
    material.update();

    const worldHeight = 0.22;
    const worldWidth = worldHeight * (canvas.width / canvas.height);
    const mesh = Mesh.fromGeometry(device, new PlaneGeometry({
        halfExtents: new Vec2(worldWidth / 2, worldHeight / 2),
        widthSegments: 1,
        lengthSegments: 1
    }));
    const label = new Entity('battlefield-choose-label');
    // Sit just past the far edge of the row so it does not cover the options.
    label.setLocalPosition(x, y, z - worldHeight * 0.85);
    label.addComponent('render', {
        meshInstances: [new MeshInstance(mesh, material)]
    });
    parent.addChild(label);
    return label;
};

class BattlefieldChoice extends Script {
    static scriptName = 'battlefieldChoice';

    artUrl = '';
    width = 0.7;
    depth = 1.02;

    private pointerStart: { x: number; y: number } | null = null;
    private suppressCamera = false;

    private readonly onPointerDown = (event: PointerEvent) => {
        if (settling || event.button !== 0 || !this.hit(event)) {
            return;
        }
        event.stopPropagation();
        this.pointerStart = { x: event.clientX, y: event.clientY };
        this.suppressCamera = true;
        setCameraEnabled(this.app, false);
    };

    private readonly onPointerUp = (event: PointerEvent) => {
        if (this.suppressCamera) {
            this.suppressCamera = false;
            setCameraEnabled(this.app, true);
        }
        const start = this.pointerStart;
        this.pointerStart = null;
        if (!start || event.button !== 0) {
            return;
        }
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (dx * dx + dy * dy > clickSlop * clickSlop) {
            return;
        }
        if (!this.hit(event)) {
            return;
        }
        event.stopPropagation();
        settleBattlefieldChoice(this.entity, this.artUrl);
    };

    initialize() {
        window.addEventListener('pointerdown', this.onPointerDown, true);
        window.addEventListener('pointerup', this.onPointerUp);
        this.on('destroy', () => {
            if (this.suppressCamera) {
                setCameraEnabled(this.app, true);
            }
            window.removeEventListener('pointerdown', this.onPointerDown, true);
            window.removeEventListener('pointerup', this.onPointerUp);
        });
    }

    private hit(event: PointerEvent) {
        const cameraNode = this.app.root.findByName('camera');
        const camera = cameraNode instanceof Entity ? cameraNode.camera : null;
        const canvas = this.app.graphicsDevice.canvas;
        if (!camera || !(canvas instanceof HTMLCanvasElement)) {
            return false;
        }
        const rect = canvas.getBoundingClientRect();
        camera.screenToWorld(event.clientX - rect.left, event.clientY - rect.top, camera.nearClip, rayNear);
        camera.screenToWorld(event.clientX - rect.left, event.clientY - rect.top, camera.farClip, rayFar);
        rayDir.sub2(rayFar, rayNear);
        // Flat projection: intersect the horizontal face plane at the card.
        const y = this.entity.getPosition().y + 0.08;
        if (Math.abs(rayDir.y) < 1e-5) {
            return false;
        }
        const t = (y - rayNear.y) / rayDir.y;
        if (t < 0 || t > 1) {
            return false;
        }
        hitPoint.set(rayNear.x + rayDir.x * t, y, rayNear.z + rayDir.z * t);
        inverse.copy(this.entity.getWorldTransform()).invert();
        inverse.transformPoint(hitPoint, localHit);
        return insideRoundedCard(localHit.x, localHit.z, this.width, this.depth);
    }
}

/**
 * Project the deck's battlefields as a flat row hovering above battlefield 1.
 * Orientation matches the seated card so every camera angle sees the same layout.
 */
export const presentBattlefieldChoices = (arts: string[]) => {
    clearBattlefieldChooser();
    if (!player || arts.length === 0) {
        return;
    }
    showPlayerBattlefield(null);

    const root = new Entity('battlefield-chooser');
    player.board.addChild(root);
    chooser = root;

    const { x, z, width, depth, blankUrl, device } = player;
    const span = arts.length * width + (arts.length - 1) * choiceGap;
    const startX = x - span / 2 + width / 2;

    addChooserLabel(root, device, x, labelLift, z - depth / 2);

    arts.forEach((artUrl, index) => {
        const cardX = startX + index * (width + choiceGap);
        const card = createDoubleSidedCard(
            root,
            device,
            cardX,
            choiceLift,
            z,
            width,
            depth,
            artUrl,
            blankUrl,
            `battlefield-choice-${index}`
        );
        const scripts = card.addComponent('script');
        if (!scripts) {
            throw new Error('Failed to create the battlefield choice');
        }
        scripts.create(BattlefieldChoice, {
            properties: {
                artUrl,
                width,
                depth
            }
        });
    });
};
