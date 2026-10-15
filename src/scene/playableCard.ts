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
let handDrop: ((card: Entity) => boolean) | null = null;
let handDraw: ((card: Entity) => void) | null = null;
let handRelease: ((card: Entity) => void) | null = null;
let handOwns: ((card: Entity, x: number, z: number) => boolean) | null = null;

/** The deck registers this so a dragged card can be returned to the pile. */
export const setDeckDrop = (handler: ((card: Entity) => boolean) | null) => {
    deckDrop = handler;
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

export const offerToHand = (card: Entity) => handDrop?.(card) ?? false;

export const drawToHand = (card: Entity) => {
    handDraw?.(card);
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

    private faceMaterial: StandardMaterial | null = null;
    private art: Texture | null = null;
    private back: Texture | null = null;
    private faceUp = false;
    private tapped = false;
    private yaw = 0;
    private yawTarget = 0;
    private holding = false;
    private dragging = false;
    private pointerStart = { x: 0, y: 0 };
    private grabX = 0;
    private grabZ = 0;

    private readonly onPointerDown = (event: PointerEvent) => {
        if (this.inDeck || event.button !== 0 || this.holding || !this.rayTable(event)) {
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
            if (this.inHand) {
                this.inHand = false;
                handRelease?.(this.entity);
            }
        }
        if (!this.dragging || !this.rayTable(event)) {
            return;
        }
        this.entity.setLocalPosition(hitPoint.x - this.grabX, liftY, hitPoint.z - this.grabZ);
    };

    private readonly onPointerUp = (event: PointerEvent) => {
        if (!this.holding || event.button !== 0) {
            return;
        }
        event.stopPropagation();
        this.holding = false;
        setCameraEnabled(this.app, true);
        if (this.dragging) {
            if (deckDrop?.(this.entity) || handDrop?.(this.entity)) {
                return;
            }
            const position = this.entity.getLocalPosition();
            this.entity.setLocalPosition(position.x, restY, position.z);
            return;
        }
        if (this.inHand) {
            return;
        }
        this.tapped = !this.tapped;
        this.yawTarget = this.tapped ? -90 : 0;
    };

    initialize() {
        window.addEventListener('pointerdown', this.onPointerDown, true);
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        this.on('destroy', () => {
            if (this.holding) {
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

    /** Square the card, turn it face down, and stop it taking its own clicks. */
    joinDeck() {
        if (this.inHand) {
            this.inHand = false;
            handRelease?.(this.entity);
        }
        this.inDeck = true;
        this.tapped = false;
        this.yaw = 0;
        this.yawTarget = 0;
        this.entity.setLocalEulerAngles(0, 0, 0);
        this.setFaceUp(false);
    }

    /** Face up, square, and kept in the hand row so a click does not turn it. */
    joinHand() {
        this.inDeck = false;
        this.inHand = true;
        this.tapped = false;
        this.yaw = 0;
        this.yawTarget = 0;
        this.entity.setLocalEulerAngles(0, 0, 0);
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

let sharedFace: Mesh | null = null;
let sharedEdge: Mesh | null = null;

const faceMesh = (device: GraphicsDevice, width: number, depth: number) => {
    sharedFace ??= roundedFaceMesh(device, width, depth);
    return sharedFace;
};

const edgeMesh = (device: GraphicsDevice, width: number, depth: number) => {
    sharedEdge ??= roundedEdgeMesh(device, width, depth, 0.02);
    return sharedEdge;
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
    inDeck: boolean
) => {
    const card = new Entity('card');
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

    const scripts = card.addComponent('script');
    if (!scripts) {
        throw new Error('Failed to create the card');
    }
    const playable = scripts.create(PlayableCard, { properties: { width, depth, inDeck } });
    if (!playable) {
        throw new Error('Failed to create the card');
    }
    playable.bindFaces(face, artUrl, backUrl);
    return card;
};
