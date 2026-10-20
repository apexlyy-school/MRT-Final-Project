import {
    ADDRESS_CLAMP_TO_EDGE,
    BLEND_NORMAL,
    Entity,
    FILTER_LINEAR,
    FILTER_LINEAR_MIPMAP_LINEAR,
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

import { CardDeck } from './deck.ts';
import { CardHand } from './hand.ts';
import { PlayableCard } from './playableCard.ts';
import { ScoreTrack } from './scoreTrack.ts';

const buttonY = 0.052;
const clickSlop = 6;
const tableY = 0.08;
const rayNear = new Vec3();
const rayFar = new Vec3();

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

const paintButton = (device: GraphicsDevice, width: number, depth: number) => {
    const pixels = 1000;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(4, Math.round(width * pixels));
    canvas.height = Math.max(4, Math.round(depth * pixels));
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Failed to draw the end turn button');
    }
    const { width: w, height: h } = canvas;
    const radius = Math.min(w, h) * 0.22;
    context.clearRect(0, 0, w, h);
    context.fillStyle = 'rgba(36, 92, 168, 0.82)';
    context.beginPath();
    context.moveTo(radius, 0);
    context.lineTo(w - radius, 0);
    context.quadraticCurveTo(w, 0, w, radius);
    context.lineTo(w, h - radius);
    context.quadraticCurveTo(w, h, w - radius, h);
    context.lineTo(radius, h);
    context.quadraticCurveTo(0, h, 0, h - radius);
    context.lineTo(0, radius);
    context.quadraticCurveTo(0, 0, radius, 0);
    context.closePath();
    context.fill();
    context.strokeStyle = 'rgba(126, 186, 255, 0.9)';
    context.lineWidth = Math.max(2, Math.round(Math.min(w, h) * 0.04));
    context.stroke();
    context.fillStyle = '#f2f7ff';
    context.font = `700 ${Math.round(h * 0.38)}px Arial, Helvetica, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('END TURN', w / 2, h / 2 + 1);

    const texture = new Texture(device, {
        name: 'end-turn',
        width: w,
        height: h,
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
    return material;
};

const zoneHand = (board: Entity, name: string) => {
    const zone = board.findByName(name);
    if (!(zone instanceof Entity) || !zone.script) {
        return null;
    }
    const hand = zone.script.get('cardHand');
    return hand instanceof CardHand ? hand : null;
};

const pile = (board: Entity, name: string) => {
    const zone = board.findByName(name);
    if (!(zone instanceof Entity) || !zone.script) {
        return null;
    }
    const deck = zone.script.get('cardDeck');
    return deck instanceof CardDeck ? deck : null;
};

const scoreTrack = (board: Entity) => {
    const track = board.findByName('score-track');
    if (!(track instanceof Entity) || !track.script) {
        return null;
    }
    const score = track.script.get('scoreTrack');
    return score instanceof ScoreTrack ? score : null;
};

const untapSeated = (board: Entity) => {
    for (const child of board.children) {
        if (!(child instanceof Entity) || !child.script) {
            continue;
        }
        const playable = child.script.get('playableCard');
        if (!(playable instanceof PlayableCard)) {
            continue;
        }
        if (playable.inDeck || playable.inTrash || playable.pinned) {
            continue;
        }
        playable.untap();
    }
};

const endTurnEffects = (board: Entity) => {
    untapSeated(board);

    const runeDeck = pile(board, 'rune-deck');
    runeDeck?.drawTop();
    runeDeck?.drawTop();

    pile(board, 'deck')?.drawTop();

    let points = 0;
    if ((zoneHand(board, 'battlefield-1')?.cards.length ?? 0) > 0) {
        points += 1;
    }
    if ((zoneHand(board, 'battlefield-2')?.cards.length ?? 0) > 0) {
        points += 1;
    }
    if (points > 0) {
        scoreTrack(board)?.gain(points);
    }
};

export class EndTurnButton extends Script {
    static scriptName = 'endTurnButton';

    originX = 0;
    originZ = 0;
    width = 1.1;
    depth = 0.38;

    private pointerStart: { x: number; y: number } | null = null;
    private suppressCamera = false;

    private readonly onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || !this.hit(event)) {
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
        const board = this.entity.parent;
        if (board instanceof Entity) {
            endTurnEffects(board);
        }
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
        const dy = rayFar.y - rayNear.y;
        if (Math.abs(dy) < 1e-5) {
            return false;
        }
        const t = (tableY - rayNear.y) / dy;
        if (t < 0 || t > 1) {
            return false;
        }
        const x = rayNear.x + (rayFar.x - rayNear.x) * t;
        const z = rayNear.z + (rayFar.z - rayNear.z) * t;
        return Math.abs(x - this.originX) <= this.width / 2 && Math.abs(z - this.originZ) <= this.depth / 2;
    }
}

export const addEndTurn = (
    parent: Entity,
    device: GraphicsDevice,
    x: number,
    z: number,
    width = 1.15,
    depth = 0.4
) => {
    const material = paintButton(device, width, depth);
    const mesh = Mesh.fromGeometry(device, new PlaneGeometry({
        halfExtents: new Vec2(width / 2, depth / 2),
        widthSegments: 1,
        lengthSegments: 1
    }));
    const button = new Entity('end-turn');
    button.setLocalPosition(x, buttonY, z);
    button.addComponent('render', {
        meshInstances: [new MeshInstance(mesh, material)]
    });
    parent.addChild(button);
    const scripts = button.addComponent('script');
    if (!scripts) {
        throw new Error('Failed to create the end turn button');
    }
    scripts.create(EndTurnButton, {
        properties: {
            originX: x,
            originZ: z,
            width,
            depth
        }
    });
};
