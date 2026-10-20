import {
    ADDRESS_CLAMP_TO_EDGE,
    Entity,
    FILTER_LINEAR,
    FILTER_LINEAR_MIPMAP_LINEAR,
    Geometry,
    Mat4,
    Mesh,
    MeshInstance,
    PIXELFORMAT_RGBA8,
    Script,
    StandardMaterial,
    Texture,
    Vec3
} from 'playcanvas';
import type { AppBase, GraphicsDevice } from 'playcanvas';

import { cancelCardMotion } from './cardMotion.ts';

const clickSlop = 6;
const cornerPortion = 0.08;
const cornerSteps = 8;
const restY = 0;
const liftY = 0.04;
const turnSpeed = 90 / 0.14;
const tableY = 0.08;

const rayNear = new Vec3();
const rayFar = new Vec3();
const hitPoint = new Vec3();
const inverse = new Mat4();
const localHit = new Vec3();

const loadCardTexture = (device: GraphicsDevice, url: string) => new Promise<Texture>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
        const texture = new Texture(device, {
            name: 'card-art',
            width: image.width,
            height: image.height,
            format: PIXELFORMAT_RGBA8,
            srgb: true,
            mipmaps: true,
            minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
            magFilter: FILTER_LINEAR,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE,
            anisotropy: Math.min(8, device.maxAnisotropy)
        });
        texture.setSource(image);
        resolve(texture);
    };
    image.onerror = () => reject(new Error('Failed to load the card'));
    image.src = url;
});

let deckDrop: ((card: Entity) => boolean) | null = null;
let deckRelease: ((card: Entity) => void) | null = null;
let deckIsTop: ((card: Entity) => boolean) | null = null;
let deckBury: ((card: Entity) => boolean) | null = null;
let handDrop: ((card: Entity) => boolean) | null = null;
let handDraw: ((card: Entity) => void) | null = null;
let handRelease: ((card: Entity) => void) | null = null;
let handOwns: ((card: Entity, x: number, z: number) => boolean) | null = null;
let runeDrop: ((card: Entity) => boolean) | null = null;
let runeDraw: ((card: Entity) => void) | null = null;
let runeRelease: ((card: Entity) => void) | null = null;
let runeOwns: ((card: Entity, x: number, z: number) => boolean) | null = null;
let baseDrop: ((card: Entity) => boolean) | null = null;
let baseRelease: ((card: Entity) => void) | null = null;
let baseOwns: ((card: Entity, x: number, z: number) => boolean) | null = null;
type BattlefieldRow = {
    drop: (card: Entity) => boolean;
    release: (card: Entity) => void;
    owns: (card: Entity, x: number, z: number) => boolean;
};

const battlefieldRows: BattlefieldRow[] = [];
let championDrop: ((card: Entity) => boolean) | null = null;
let championRelease: ((card: Entity) => void) | null = null;
let trashDrop: ((card: Entity) => boolean) | null = null;
let trashSend: ((card: Entity) => void) | null = null;
let trashRelease: ((card: Entity) => void) | null = null;

/** The deck registers this so a dragged card can be returned to the pile. */
export const setDeckDrop = (handler: ((card: Entity) => boolean) | null) => {
    deckDrop = handler;
};

/** The deck registers removal and which card is currently on top. */
export const setDeckPile = (handlers: {
    release: (card: Entity) => void;
    isTop: (card: Entity) => boolean;
    bury: (card: Entity) => boolean;
} | null) => {
    deckRelease = handlers?.release ?? null;
    deckIsTop = handlers?.isTop ?? null;
    deckBury = handlers?.bury ?? null;
};

/** The hand registers draw, drop, and overlap picking. */
export const setHand = (handlers: {
    drop: (card: Entity) => boolean;
    draw: (card: Entity) => void;
    release: (card: Entity) => void;
    owns: (card: Entity, x: number, z: number) => boolean;
} | null) => {
    handDrop = handlers?.drop ?? null;
    handDraw = handlers?.draw ?? null;
    handRelease = handlers?.release ?? null;
    handOwns = handlers?.owns ?? null;
};

export const offerToDeck = (card: Entity) => deckDrop?.(card) ?? false;

export const offerToHand = (card: Entity) => handDrop?.(card) ?? false;

export const drawToHand = (card: Entity) => {
    handDraw?.(card);
};

/** The rune area registers the same row behaviour as the hand. */
export const setRuneArea = (handlers: {
    drop: (card: Entity) => boolean;
    draw: (card: Entity) => void;
    release: (card: Entity) => void;
    owns: (card: Entity, x: number, z: number) => boolean;
} | null) => {
    runeDrop = handlers?.drop ?? null;
    runeDraw = handlers?.draw ?? null;
    runeRelease = handlers?.release ?? null;
    runeOwns = handlers?.owns ?? null;
};

export const offerToRuneArea = (card: Entity) => runeDrop?.(card) ?? false;

export const drawToRuneArea = (card: Entity) => {
    runeDraw?.(card);
};

/** The base registers the same row behaviour as the rune area, with cards seated tapped. */
export const setBase = (handlers: {
    drop: (card: Entity) => boolean;
    release: (card: Entity) => void;
    owns: (card: Entity, x: number, z: number) => boolean;
} | null) => {
    baseDrop = handlers?.drop ?? null;
    baseRelease = handlers?.release ?? null;
    baseOwns = handlers?.owns ?? null;
};

export const offerToBase = (card: Entity) => baseDrop?.(card) ?? false;

/** Battlefield 1 and 2 rows register here so either can accept a drop. */
export const registerBattlefieldRow = (handlers: BattlefieldRow) => {
    battlefieldRows.push(handlers);
    return () => {
        const index = battlefieldRows.indexOf(handlers);
        if (index >= 0) {
            battlefieldRows.splice(index, 1);
        }
    };
};

export const offerToBattlefield = (card: Entity) => battlefieldRows.some((row) => row.drop(card));

/** Remove a card from every battlefield row without joining another zone. */
export const vacateBattlefield = (card: Entity) => {
    for (const row of battlefieldRows) {
        row.release(card);
    }
};

const ownsOnBattlefield = (card: Entity, x: number, z: number) => {
    return battlefieldRows.some((row) => row.owns(card, x, z));
};

const rowRelayouts: ((card: Entity) => void)[] = [];

/** Seating rows register so a tap can restack overlap order. */
export const registerRowRelayout = (handler: (card: Entity) => void) => {
    rowRelayouts.push(handler);
    return () => {
        const index = rowRelayouts.indexOf(handler);
        if (index >= 0) {
            rowRelayouts.splice(index, 1);
        }
    };
};

const requestRowRelayout = (card: Entity) => {
    for (const relayout of rowRelayouts) {
        relayout(card);
    }
};

export const buryInMatchingDeck = (card: Entity) => deckBury?.(card) ?? false;

/** The chosen-champion slot registers drop and removal. */
export const setChampionZone = (handlers: {
    drop: (card: Entity) => boolean;
    release: (card: Entity) => void;
} | null) => {
    championDrop = handlers?.drop ?? null;
    championRelease = handlers?.release ?? null;
};

export const offerToChampion = (card: Entity) => championDrop?.(card) ?? false;

/** The trash registers drop, right-click discard, and removal when a card is dragged out. */
export const setTrash = (handlers: {
    drop: (card: Entity) => boolean;
    send: (card: Entity) => void;
    release: (card: Entity) => void;
} | null) => {
    trashDrop = handlers?.drop ?? null;
    trashSend = handlers?.send ?? null;
    trashRelease = handlers?.release ?? null;
};

export const offerToTrash = (card: Entity) => trashDrop?.(card) ?? false;

export const sendToTrash = (card: Entity) => {
    trashSend?.(card);
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

export class PlayableCard extends Script {
    static scriptName = 'playableCard';

    width = 0.7;
    depth = 1.02;
    inDeck = false;
    inHand = false;
    inTrash = false;
    inRuneArea = false;
    rune = false;
    pinned = false;
    champion = false;
    inChampion = false;
    inBase = false;
    inBattlefield = false;
    /** Display stack in a seating row. Lower values draw on top. 0 means unset. */
    layer = 0;

    private faceMaterial: StandardMaterial | null = null;
    private art: Texture | null = null;
    private back: Texture | null = null;
    private faceUp = false;
    private tapped = false;
    private yaw = 0;
    private yawTarget = 0;
    /** Last seating zone. Re-entering the same zone keeps tap orientation. */
    private seat: string | null = null;
    private holding = false;
    private dragging = false;
    private pointerStart = { x: 0, y: 0 };
    private grabX = 0;
    private grabZ = 0;
    private suppressCamera = false;

    private readonly onPointerDown = (event: PointerEvent) => {
        if (event.button === 2) {
            this.discard(event);
            return;
        }
        if (this.inDeck || this.inTrash || event.button !== 0 || this.holding || !this.rayTable(event)) {
            return;
        }
        const worldX = hitPoint.x;
        const worldZ = hitPoint.z;
        if (!this.contains(worldX, worldZ)) {
            return;
        }
        if (this.inHand && handOwns && !handOwns(this.entity, worldX, worldZ)) {
            return;
        }
        if (this.inRuneArea && runeOwns && !runeOwns(this.entity, worldX, worldZ)) {
            return;
        }
        if (this.inBase && baseOwns && !baseOwns(this.entity, worldX, worldZ)) {
            return;
        }
        if (this.inBattlefield && !ownsOnBattlefield(this.entity, worldX, worldZ)) {
            return;
        }
        event.stopPropagation();
        const position = this.entity.getPosition();
        this.holding = true;
        this.dragging = false;
        this.pointerStart.x = event.clientX;
        this.pointerStart.y = event.clientY;
        this.grabX = worldX - position.x;
        this.grabZ = worldZ - position.z;
        setCameraEnabled(this.app, false);
    };

    private readonly onPointerMove = (event: PointerEvent) => {
        if (!this.holding) {
            return;
        }
        const dx = event.clientX - this.pointerStart.x;
        const dy = event.clientY - this.pointerStart.y;
        if (!this.dragging && dx * dx + dy * dy > clickSlop * clickSlop) {
            this.dragging = true;
            if (this.pinned) {
                return;
            }
            if (this.inHand) {
                this.inHand = false;
                handRelease?.(this.entity);
            }
            if (this.inTrash) {
                this.inTrash = false;
                trashRelease?.(this.entity);
            }
            if (this.inRuneArea) {
                this.inRuneArea = false;
                runeRelease?.(this.entity);
            }
            if (this.inChampion) {
                this.inChampion = false;
                championRelease?.(this.entity);
            }
            if (this.inBase) {
                this.inBase = false;
                baseRelease?.(this.entity);
            }
            if (this.inBattlefield) {
                this.inBattlefield = false;
                this.layer = 0;
                vacateBattlefield(this.entity);
            }
        }
        if (this.pinned || !this.dragging || !this.rayTable(event)) {
            return;
        }
        cancelCardMotion(this.entity);
        this.entity.setLocalPosition(hitPoint.x - this.grabX, liftY, hitPoint.z - this.grabZ);
    };

    private readonly onPointerUp = (event: PointerEvent) => {
        if (event.button === 2 && this.suppressCamera) {
            this.suppressCamera = false;
            setCameraEnabled(this.app, true);
            return;
        }
        if (!this.holding || event.button !== 0) {
            return;
        }
        event.stopPropagation();
        this.holding = false;
        setCameraEnabled(this.app, true);
        if (this.dragging) {
            if (this.pinned) {
                return;
            }
            const placed = this.rune
                ? offerToDeck(this.entity) || offerToRuneArea(this.entity)
                : offerToChampion(this.entity) || offerToBattlefield(this.entity) || offerToBase(this.entity) || (deckDrop?.(this.entity) ?? false) || (handDrop?.(this.entity) ?? false) || (trashDrop?.(this.entity) ?? false);
            if (placed) {
                return;
            }
            const position = this.entity.getLocalPosition();
            this.entity.setLocalPosition(position.x, restY, position.z);
            return;
        }
        if (this.inHand || this.inChampion) {
            return;
        }
        this.tapped = !this.tapped;
        this.yawTarget = this.tapped ? -90 : 0;
        requestRowRelayout(this.entity);
    };

    isTapped() {
        return this.tapped;
    }

    /** Stand the card upright. Used at turn end for every seated card. */
    untap() {
        if (!this.tapped) {
            return;
        }
        this.tapped = false;
        this.yawTarget = 0;
        requestRowRelayout(this.entity);
    }

    initialize() {
        window.addEventListener('pointerdown', this.onPointerDown, true);
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        this.on('destroy', () => {
            if (this.holding || this.suppressCamera) {
                setCameraEnabled(this.app, true);
            }
            window.removeEventListener('pointerdown', this.onPointerDown, true);
            window.removeEventListener('pointermove', this.onPointerMove);
            window.removeEventListener('pointerup', this.onPointerUp);
        });
    }

    update(dt: number) {
        if (this.yaw === this.yawTarget) {
            return;
        }
        const step = turnSpeed * dt;
        this.yaw = this.yawTarget > this.yaw
            ? Math.min(this.yawTarget, this.yaw + step)
            : Math.max(this.yawTarget, this.yaw - step);
        this.entity.setLocalEulerAngles(0, this.yaw, 0);
    }

    private discard(event: PointerEvent) {
        if (this.pinned || this.holding || this.inTrash || !this.rayTable(event)) {
            return;
        }
        const worldX = hitPoint.x;
        const worldZ = hitPoint.z;
        if (!this.contains(worldX, worldZ)) {
            return;
        }
        const fromDeck = this.inDeck && (deckIsTop?.(this.entity) ?? false);
        if (this.inDeck && !fromDeck) {
            return;
        }
        if (this.rune) {
            if (!fromDeck && !this.inRuneArea && !this.faceUp) {
                return;
            }
            if (this.inRuneArea && runeOwns && !runeOwns(this.entity, worldX, worldZ)) {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            this.suppressCamera = true;
            setCameraEnabled(this.app, false);
            buryInMatchingDeck(this.entity);
            return;
        }
        if (!fromDeck && !this.inHand && !this.faceUp) {
            return;
        }
        if (this.inHand && handOwns && !handOwns(this.entity, worldX, worldZ)) {
            return;
        }
        if (this.inBase && baseOwns && !baseOwns(this.entity, worldX, worldZ)) {
            return;
        }
        if (this.inBattlefield && !ownsOnBattlefield(this.entity, worldX, worldZ)) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        this.suppressCamera = true;
        setCameraEnabled(this.app, false);
        sendToTrash(this.entity);
    }

    private leaveBattlefield() {
        if (this.inBattlefield) {
            this.inBattlefield = false;
            this.layer = 0;
            vacateBattlefield(this.entity);
        }
    }

    /** Apply a zone's default tap only when entering from a different seat. */
    private applySeat(seat: string, defaultTapped: boolean) {
        const keep = this.seat === seat;
        this.seat = seat;
        if (keep) {
            return;
        }
        this.tapped = defaultTapped;
        const yaw = defaultTapped ? -90 : 0;
        this.yaw = yaw;
        this.yawTarget = yaw;
        this.entity.setLocalEulerAngles(0, yaw, 0);
    }

    /** Square the card, turn it face down, and stop it taking its own clicks. */
    joinDeck() {
        if (this.inHand) {
            this.inHand = false;
            handRelease?.(this.entity);
        }
        if (this.inTrash) {
            this.inTrash = false;
            trashRelease?.(this.entity);
        }
        if (this.inRuneArea) {
            this.inRuneArea = false;
            runeRelease?.(this.entity);
        }
        if (this.inChampion) {
            this.inChampion = false;
            championRelease?.(this.entity);
        }
        if (this.inBase) {
            this.inBase = false;
            baseRelease?.(this.entity);
        }
        this.leaveBattlefield();
        this.inDeck = true;
        this.applySeat('deck', false);
        this.setFaceUp(false);
    }

    /** Face up, square, and kept in the hand row so a click does not turn it. */
    joinHand() {
        if (this.inTrash) {
            this.inTrash = false;
            trashRelease?.(this.entity);
        }
        if (this.inRuneArea) {
            this.inRuneArea = false;
            runeRelease?.(this.entity);
        }
        if (this.inChampion) {
            this.inChampion = false;
            championRelease?.(this.entity);
        }
        if (this.inBase) {
            this.inBase = false;
            baseRelease?.(this.entity);
        }
        this.leaveBattlefield();
        this.inDeck = false;
        this.inHand = true;
        this.applySeat('hand', false);
        this.setFaceUp(true);
    }

    /** Face up in the rune area. A click turns it 90 degrees. */
    joinRuneArea() {
        if (this.inDeck) {
            this.inDeck = false;
            deckRelease?.(this.entity);
        }
        if (this.inHand) {
            this.inHand = false;
            handRelease?.(this.entity);
        }
        if (this.inTrash) {
            this.inTrash = false;
            trashRelease?.(this.entity);
        }
        if (this.inChampion) {
            this.inChampion = false;
            championRelease?.(this.entity);
        }
        if (this.inBase) {
            this.inBase = false;
            baseRelease?.(this.entity);
        }
        this.leaveBattlefield();
        this.inRuneArea = true;
        this.applySeat('rune', false);
        this.setFaceUp(true);
    }

    /** Face up on the trash pile. A click stays put; only a drag takes it out. */
    joinTrash() {
        if (this.inHand) {
            this.inHand = false;
            handRelease?.(this.entity);
        }
        if (this.inRuneArea) {
            this.inRuneArea = false;
            runeRelease?.(this.entity);
        }
        if (this.inDeck) {
            this.inDeck = false;
            deckRelease?.(this.entity);
        }
        if (this.inChampion) {
            this.inChampion = false;
            championRelease?.(this.entity);
        }
        if (this.inBase) {
            this.inBase = false;
            baseRelease?.(this.entity);
        }
        this.leaveBattlefield();
        this.inTrash = true;
        this.applySeat('trash', false);
        this.setFaceUp(true);
    }

    /** Face up in the chosen-champion slot. A click does not turn it. */
    joinChampion() {
        if (this.inDeck) {
            this.inDeck = false;
            deckRelease?.(this.entity);
        }
        if (this.inHand) {
            this.inHand = false;
            handRelease?.(this.entity);
        }
        if (this.inTrash) {
            this.inTrash = false;
            trashRelease?.(this.entity);
        }
        if (this.inRuneArea) {
            this.inRuneArea = false;
            runeRelease?.(this.entity);
        }
        if (this.inBase) {
            this.inBase = false;
            baseRelease?.(this.entity);
        }
        this.leaveBattlefield();
        this.inChampion = true;
        this.applySeat('champion', false);
        this.setFaceUp(true);
    }

    /** Face up in the base. New arrivals enter tapped; re-seats keep orientation. */
    joinBase() {
        if (this.inDeck) {
            this.inDeck = false;
            deckRelease?.(this.entity);
        }
        if (this.inHand) {
            this.inHand = false;
            handRelease?.(this.entity);
        }
        if (this.inTrash) {
            this.inTrash = false;
            trashRelease?.(this.entity);
        }
        if (this.inRuneArea) {
            this.inRuneArea = false;
            runeRelease?.(this.entity);
        }
        if (this.inChampion) {
            this.inChampion = false;
            championRelease?.(this.entity);
        }
        this.leaveBattlefield();
        this.inBase = true;
        this.applySeat('base', true);
        this.setFaceUp(true);
    }

    /** Face up on a battlefield row. New arrivals enter tapped; re-seats keep orientation. */
    joinBattlefield(lane = 1) {
        if (this.inDeck) {
            this.inDeck = false;
            deckRelease?.(this.entity);
        }
        if (this.inHand) {
            this.inHand = false;
            handRelease?.(this.entity);
        }
        if (this.inTrash) {
            this.inTrash = false;
            trashRelease?.(this.entity);
        }
        if (this.inRuneArea) {
            this.inRuneArea = false;
            runeRelease?.(this.entity);
        }
        if (this.inChampion) {
            this.inChampion = false;
            championRelease?.(this.entity);
        }
        if (this.inBase) {
            this.inBase = false;
            baseRelease?.(this.entity);
        }
        this.inBattlefield = true;
        this.applySeat(`battlefield-${lane}`, true);
        this.setFaceUp(true);
    }

    covers(x: number, z: number) {
        return this.contains(x, z);
    }

    /** Face down shows the shared card back. Face up shows this card's art. */
    setFaceUp(faceUp: boolean) {
        this.faceUp = faceUp;
        this.applyMaps();
    }

    bindFaces(material: StandardMaterial, artUrl: string, backUrl: string) {
        this.faceMaterial = material;
        void textureFor(this.app.graphicsDevice, artUrl).then((texture) => {
            this.art = texture;
            this.applyMaps();
        });
        void textureFor(this.app.graphicsDevice, backUrl).then((texture) => {
            this.back = texture;
            this.applyMaps();
        });
    }

    private applyMaps() {
        const map = this.faceUp ? this.art : this.back;
        if (!map || !this.faceMaterial) {
            return;
        }
        this.faceMaterial.diffuseMap = map;
        this.faceMaterial.update();
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
        hitPoint.x = rayNear.x + (rayFar.x - rayNear.x) * t;
        hitPoint.y = tableY;
        hitPoint.z = rayNear.z + (rayFar.z - rayNear.z) * t;
        return true;
    }

    private contains(x: number, z: number) {
        localHit.set(x, tableY, z);
        inverse.copy(this.entity.getWorldTransform()).invert();
        inverse.transformPoint(localHit, localHit);
        return insideRoundedCard(localHit.x, localHit.z, this.width, this.depth);
    }
}

const cardCornerRadius = (width: number, depth: number) => Math.min(width, depth) * cornerPortion;

export const insideRoundedCard = (x: number, z: number, width: number, depth: number) => {
    const radius = cardCornerRadius(width, depth);
    const halfX = width / 2;
    const halfZ = depth / 2;
    const ax = Math.abs(x);
    const az = Math.abs(z);
    if (ax > halfX || az > halfZ) {
        return false;
    }
    const insetX = halfX - radius;
    const insetZ = halfZ - radius;
    if (ax <= insetX || az <= insetZ) {
        return true;
    }
    const dx = ax - insetX;
    const dz = az - insetZ;
    return dx * dx + dz * dz <= radius * radius;
};

// Outline runs around the card with the top face pointing up, matching the built-in plane's corners.
const roundedOutline = (width: number, depth: number) => {
    const halfX = width / 2;
    const halfZ = depth / 2;
    const radius = cardCornerRadius(width, depth);
    const corners: [number, number, number, number][] = [
        [halfX - radius, -halfZ + radius, -Math.PI / 2, 0],
        [halfX - radius, halfZ - radius, 0, Math.PI / 2],
        [-halfX + radius, halfZ - radius, Math.PI / 2, Math.PI],
        [-halfX + radius, -halfZ + radius, Math.PI, Math.PI * 1.5]
    ];
    const points: [number, number][] = [];
    for (const [cx, cz, start, end] of corners) {
        for (let i = 0; i <= cornerSteps; i++) {
            const angle = start + (end - start) * (i / cornerSteps);
            points.push([cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius]);
        }
    }
    return points;
};

const roundedFaceMesh = (device: GraphicsDevice, width: number, depth: number) => {
    const outline = roundedOutline(width, depth);
    const positions = [0, 0, 0];
    const normals = [0, 1, 0];
    const uvs = [0.5, 0.5];
    for (const [x, z] of outline) {
        positions.push(x, 0, z);
        normals.push(0, 1, 0);
        uvs.push(x / width + 0.5, z / depth + 0.5);
    }
    const indices: number[] = [];
    for (let i = 0; i < outline.length; i++) {
        // Wound so the face points up. The opposite order is only visible from below.
        indices.push(0, ((i + 1) % outline.length) + 1, i + 1);
    }
    const geometry = new Geometry();
    geometry.positions = positions;
    geometry.normals = normals;
    geometry.uvs = uvs;
    geometry.indices = indices;
    return Mesh.fromGeometry(device, geometry);
};

const roundedEdgeMesh = (device: GraphicsDevice, width: number, depth: number, height: number) => {
    const outline = roundedOutline(width, depth);
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < outline.length; i++) {
        const [x0, z0] = outline[i];
        const [x1, z1] = outline[(i + 1) % outline.length];
        const dx = x1 - x0;
        const dz = z1 - z0;
        const length = Math.hypot(dx, dz) || 1;
        const nx = dz / length;
        const nz = -dx / length;
        const base = positions.length / 3;
        positions.push(x0, 0, z0, x0, height, z0, x1, height, z1, x1, 0, z1);
        normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geometry = new Geometry();
    geometry.positions = positions;
    geometry.normals = normals;
    geometry.indices = indices;
    return Mesh.fromGeometry(device, geometry);
};

const addMeshInstance = (parent: Entity, name: string, mesh: Mesh, material: StandardMaterial, y: number) => {
    const entity = new Entity(name);
    entity.setLocalPosition(0, y, 0);
    entity.addComponent('render', {
        meshInstances: [new MeshInstance(mesh, material)]
    });
    parent.addChild(entity);
    return entity;
};

const textureCache = new Map<string, Promise<Texture>>();

const textureFor = (device: GraphicsDevice, url: string) => {
    const cached = textureCache.get(url);
    if (cached) {
        return cached;
    }
    const pending = loadCardTexture(device, url);
    textureCache.set(url, pending);
    return pending;
};

/** Turns a portrait image into a landscape texture so it can fill a sideways battlefield card. */
const loadRotatedCardTexture = (device: GraphicsDevice, url: string) => new Promise<Texture>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.height;
        canvas.height = image.width;
        const context = canvas.getContext('2d');
        if (!context) {
            reject(new Error('Failed to rotate the card'));
            return;
        }
        context.translate(canvas.width, 0);
        context.rotate(Math.PI / 2);
        context.drawImage(image, 0, 0);
        const texture = new Texture(device, {
            name: 'card-art-rotated',
            width: canvas.width,
            height: canvas.height,
            format: PIXELFORMAT_RGBA8,
            srgb: true,
            mipmaps: true,
            minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
            magFilter: FILTER_LINEAR,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE,
            anisotropy: Math.min(8, device.maxAnisotropy)
        });
        texture.setSource(canvas);
        resolve(texture);
    };
    image.onerror = () => reject(new Error('Failed to load the card'));
    image.src = url;
});

const textureRotatedFor = (device: GraphicsDevice, url: string) => {
    const key = `${url}|rot90`;
    const cached = textureCache.get(key);
    if (cached) {
        return cached;
    }
    const pending = loadRotatedCardTexture(device, url);
    textureCache.set(key, pending);
    return pending;
};

const sharedFaces = new Map<string, Mesh>();
const sharedEdges = new Map<string, Mesh>();

const keepMesh = (mesh: Mesh) => {
    mesh.incRefCount();
    return mesh;
};

const meshKey = (width: number, depth: number) => `${width.toFixed(4)}x${depth.toFixed(4)}`;

const faceMesh = (device: GraphicsDevice, width: number, depth: number) => {
    const key = meshKey(width, depth);
    const cached = sharedFaces.get(key);
    if (cached) {
        return cached;
    }
    const mesh = keepMesh(roundedFaceMesh(device, width, depth));
    sharedFaces.set(key, mesh);
    return mesh;
};

const edgeMesh = (device: GraphicsDevice, width: number, depth: number) => {
    const key = meshKey(width, depth);
    const cached = sharedEdges.get(key);
    if (cached) {
        return cached;
    }
    const mesh = keepMesh(roundedEdgeMesh(device, width, depth, 0.02));
    sharedEdges.set(key, mesh);
    return mesh;
};

const buildCardShell = (
    parent: Entity,
    device: GraphicsDevice,
    x: number,
    z: number,
    width: number,
    depth: number,
    name: string
) => {
    const card = new Entity(name);
    card.setLocalPosition(x, restY, z);
    parent.addChild(card);

    const edge = new StandardMaterial();
    edge.diffuse.fromString('#102033');
    edge.update();
    addMeshInstance(card, 'card-edge', edgeMesh(device, width, depth), edge, 0.06);

    const face = new StandardMaterial();
    face.diffuse.fromString('#ffffff');
    face.useLighting = false;
    face.update();
    addMeshInstance(card, 'card-face', faceMesh(device, width, depth), face, 0.08);
    return { card, face };
};

/** A card with no pointer handlers. Deck swaps leave it alone because its name is not `card`. */
export const createStaticCard = (
    parent: Entity,
    device: GraphicsDevice,
    x: number,
    z: number,
    width: number,
    depth: number,
    artUrl: string,
    name: string,
    rotateArt = false
) => {
    const { card, face } = buildCardShell(parent, device, x, z, width, depth, name);
    const load = rotateArt ? textureRotatedFor : textureFor;
    void load(device, artUrl).then((texture) => {
        face.diffuseMap = texture;
        face.update();
    });
    return card;
};

/** Double-sided card: face on top, back on the underside. Caller can pitch it upright. */
export const createDoubleSidedCard = (
    parent: Entity,
    device: GraphicsDevice,
    x: number,
    y: number,
    z: number,
    width: number,
    depth: number,
    frontUrl: string,
    backUrl: string,
    name: string,
    rotateFront = false
) => {
    const { card, face } = buildCardShell(parent, device, x, z, width, depth, name);
    card.setLocalPosition(x, y, z);

    const backMaterial = new StandardMaterial();
    backMaterial.diffuse.fromString('#ffffff');
    backMaterial.useLighting = false;
    backMaterial.update();
    const back = addMeshInstance(card, 'card-back', faceMesh(device, width, depth), backMaterial, 0.06);
    back.setLocalEulerAngles(180, 0, 0);

    const loadFront = rotateFront ? textureRotatedFor : textureFor;
    void loadFront(device, frontUrl).then((texture) => {
        face.diffuseMap = texture;
        face.update();
    });
    // Battlefield backs are portrait; rotate so they match the landscape shell.
    void textureRotatedFor(device, backUrl).then((texture) => {
        backMaterial.diffuseMap = texture;
        backMaterial.update();
    });
    return card;
};

export const createPlayableCard = (
    parent: Entity,
    device: GraphicsDevice,
    x: number,
    z: number,
    width: number,
    depth: number,
    artUrl: string,
    backUrl: string,
    inDeck: boolean,
    rune = false,
    pinned = false,
    champion = false
) => {
    const { card, face } = buildCardShell(parent, device, x, z, width, depth, 'card');

    const scripts = card.addComponent('script');
    if (!scripts) {
        throw new Error('Failed to create the card');
    }
    const playable = scripts.create(PlayableCard, { properties: { width, depth, inDeck, rune, pinned, champion } });
    if (!playable) {
        throw new Error('Failed to create the card');
    }
    playable.bindFaces(face, artUrl, backUrl);
    return card;
};
