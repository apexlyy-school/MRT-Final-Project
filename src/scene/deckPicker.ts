import {
    ADDRESS_CLAMP_TO_EDGE,
    Entity,
    FILTER_LINEAR,
    FILTER_LINEAR_MIPMAP_LINEAR,
    Mesh,
    MeshInstance,
    PIXELFORMAT_RGBA8,
    PlaneGeometry,
    StandardMaterial,
    Texture,
    Vec2,
    Vec3
} from 'playcanvas';
import type { AppBase } from 'playcanvas';

import type { DeckList } from './cardCatalog.ts';
import type { CardDeck } from './deck.ts';

const headerY = 0.052;
const listY = headerY;
const clickSlop = 6;
const maxNames = 6;
const rowDepth = 0.26;
const rayNear = new Vec3();
const rayFar = new Vec3();

type ListRow = {
    kind: 'up' | 'down' | 'deck';
    list?: DeckList;
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

const rayPlane = (app: AppBase, event: { clientX: number; clientY: number }, y: number) => {
    const cameraNode = app.root.findByName('camera');
    const camera = cameraNode instanceof Entity ? cameraNode.camera : null;
    const canvas = app.graphicsDevice.canvas;
    if (!camera || !(canvas instanceof HTMLCanvasElement)) {
        return null;
    }
    const rect = canvas.getBoundingClientRect();
    camera.screenToWorld(event.clientX - rect.left, event.clientY - rect.top, camera.nearClip, rayNear);
    camera.screenToWorld(event.clientX - rect.left, event.clientY - rect.top, camera.farClip, rayFar);
    const dy = rayFar.y - rayNear.y;
    if (Math.abs(dy) < 1e-5) {
        return null;
    }
    const t = (y - rayNear.y) / dy;
    if (t < 0 || t > 1) {
        return null;
    }
    return {
        x: rayNear.x + (rayFar.x - rayNear.x) * t,
        z: rayNear.z + (rayFar.z - rayNear.z) * t
    };
};

const contains = (x: number, z: number, originX: number, originZ: number, width: number, depth: number) => {
    return Math.abs(x - originX) <= width / 2 && Math.abs(z - originZ) <= depth / 2;
};

const makeTexture = (device: AppBase['graphicsDevice'], canvas: HTMLCanvasElement, name: string) => {
    const texture = new Texture(device, {
        name,
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
    material.useLighting = false;
    material.update();
    return { texture, material };
};

const addPlane = (parent: Entity, device: AppBase['graphicsDevice'], material: StandardMaterial, x: number, y: number, z: number, width: number, depth: number, name: string) => {
    const mesh = Mesh.fromGeometry(device, new PlaneGeometry({
        halfExtents: new Vec2(width / 2, depth / 2),
        widthSegments: 1,
        lengthSegments: 1
    }));
    const panel = new Entity(name);
    panel.setLocalPosition(x, y, z);
    panel.addComponent('render', {
        meshInstances: [new MeshInstance(mesh, material)]
    });
    parent.addChild(panel);
    return panel;
};

const strokeFrame = (context: CanvasRenderingContext2D, width: number, height: number) => {
    context.strokeStyle = '#5d7598';
    context.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.04));
    const inset = context.lineWidth / 2;
    context.strokeRect(inset, inset, width - context.lineWidth, height - context.lineWidth);
};

const paintHeader = (canvas: HTMLCanvasElement, texture: Texture, name: string, open: boolean) => {
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Failed to draw the deck selector');
    }
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#1a3258';
    context.fillRect(0, 0, width, height);
    strokeFrame(context, width, height);
    const font = Math.round(height * 0.42);
    const pad = Math.round(height * 0.18);
    context.font = `600 ${font}px Arial`;
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillStyle = '#9aafc6';
    context.fillText('Deck', pad, height / 2);
    const nameX = pad + context.measureText('Deck').width + pad;
    context.fillStyle = '#e4edf6';
    context.save();
    context.beginPath();
    context.rect(nameX, pad, width - nameX - height, height - pad * 2);
    context.clip();
    context.fillText(name, nameX, height / 2);
    context.restore();
    const chevronX = width - height * 0.55;
    const chevronY = height / 2;
    const size = height * 0.16;
    context.fillStyle = '#e4edf6';
    context.beginPath();
    if (open) {
        context.moveTo(chevronX - size, chevronY + size * 0.6);
        context.lineTo(chevronX + size, chevronY + size * 0.6);
        context.lineTo(chevronX, chevronY - size * 0.7);
    } else {
        context.moveTo(chevronX - size, chevronY - size * 0.6);
        context.lineTo(chevronX + size, chevronY - size * 0.6);
        context.lineTo(chevronX, chevronY + size * 0.7);
    }
    context.closePath();
    context.fill();
    texture.setSource(canvas);
};

const paintList = (canvas: HTMLCanvasElement, texture: Texture, rows: ListRow[], active: string, canUp: boolean, canDown: boolean) => {
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Failed to draw the deck list');
    }
    const { width, height } = canvas;
    const rowHeight = height / rows.length;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#1a3258';
    context.fillRect(0, 0, width, height);
    strokeFrame(context, width, height);
    const font = Math.round(rowHeight * 0.42);
    context.font = `600 ${font}px Arial`;
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    rows.forEach((row, index) => {
        const y = index * rowHeight;
        const selected = row.kind === 'deck' && row.list?.name === active;
        if (selected) {
            context.fillStyle = '#23456f';
            context.fillRect(0, y, width, rowHeight);
        }
        context.strokeStyle = '#5d7598';
        context.lineWidth = Math.max(1, Math.round(rowHeight * 0.03));
        context.beginPath();
        context.moveTo(0, y + rowHeight);
        context.lineTo(width, y + rowHeight);
        context.stroke();
        const enabled = row.kind === 'deck' || (row.kind === 'up' ? canUp : canDown);
        context.fillStyle = selected ? '#7ee8c8' : enabled ? '#e4edf6' : '#5d7598';
        context.save();
        context.beginPath();
        context.rect(rowHeight * 0.2, y, width - rowHeight * 0.4, rowHeight);
        context.clip();
        const label = row.kind === 'deck' ? row.list?.name ?? '' : row.kind === 'up' ? 'Scroll up' : 'Scroll down';
        context.fillText(label, rowHeight * 0.35, y + rowHeight / 2);
        context.restore();
    });
    texture.setSource(canvas);
};

export const mountDeckPicker = (
    app: AppBase,
    board: Entity,
    deck: CardDeck,
    lists: DeckList[],
    active: DeckList,
    anchor: { x: number; z: number; width: number; depth: number }
) => {
    const showScroll = lists.length > maxNames;
    const nameRows = Math.min(maxNames, lists.length);
    const rowCount = nameRows + (showScroll ? 2 : 0);
    const listDepth = rowCount * rowDepth;
    const listZ = anchor.z + anchor.depth / 2 + 0.02 + listDepth / 2;

    const headerCanvas = document.createElement('canvas');
    headerCanvas.width = Math.max(4, Math.round(anchor.width * 1000));
    headerCanvas.height = Math.max(4, Math.round(anchor.depth * 1000));
    const headerArt = makeTexture(app.graphicsDevice, headerCanvas, 'deck-picker');
    const listCanvas = document.createElement('canvas');
    listCanvas.width = headerCanvas.width;
    listCanvas.height = Math.max(4, Math.round(listDepth * 1000));
    const listArt = makeTexture(app.graphicsDevice, listCanvas, 'deck-list');

    const header = addPlane(board, app.graphicsDevice, headerArt.material, anchor.x, headerY, anchor.z, anchor.width, anchor.depth, 'deck-picker');
    const listPanel = addPlane(board, app.graphicsDevice, listArt.material, anchor.x, listY, listZ, anchor.width, listDepth, 'deck-list');

    let current = active;
    let open = false;
    let scroll = Math.max(0, lists.findIndex((list) => list.name === active.name));
    if (scroll > lists.length - nameRows) {
        scroll = Math.max(0, lists.length - nameRows);
    }
    let rows: ListRow[] = [];
    let holding = false;
    let pointerStart = { x: 0, y: 0 };
    let pending: 'header' | ListRow | null = null;

    const visibleRows = (): ListRow[] => {
        const names = lists.slice(scroll, scroll + nameRows).map((list): ListRow => ({ kind: 'deck', list }));
        if (!showScroll) {
            return names;
        }
        return [{ kind: 'up' }, ...names, { kind: 'down' }];
    };

    const redraw = () => {
        paintHeader(headerCanvas, headerArt.texture, current.name, open);
        rows = visibleRows();
        paintList(listCanvas, listArt.texture, rows, current.name, scroll > 0, scroll + nameRows < lists.length);
        listPanel.enabled = open;
    };
    redraw();

    const rowAt = (z: number) => {
        const py = ((z - listZ) / listDepth + 0.5) * listCanvas.height;
        const index = Math.floor(py / (listCanvas.height / rows.length));
        return rows[index] ?? null;
    };

    const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || holding) {
            return;
        }
        const headerHit = rayPlane(app, event, headerY);
        const onHeader = headerHit !== null && contains(headerHit.x, headerHit.z, anchor.x, anchor.z, anchor.width, anchor.depth);
        const listHit = open ? rayPlane(app, event, listY) : null;
        const onList = listHit !== null && contains(listHit.x, listHit.z, anchor.x, listZ, anchor.width, listDepth);
        if (!onHeader && !onList) {
            if (open) {
                open = false;
                redraw();
                event.stopImmediatePropagation();
            }
            return;
        }
        event.stopImmediatePropagation();
        holding = true;
        pointerStart = { x: event.clientX, y: event.clientY };
        pending = onHeader || !listHit ? 'header' : rowAt(listHit.z);
        setCameraEnabled(app, false);
    };

    const onPointerUp = (event: PointerEvent) => {
        if (!holding || event.button !== 0) {
            return;
        }
        event.stopImmediatePropagation();
        holding = false;
        setCameraEnabled(app, true);
        const dx = event.clientX - pointerStart.x;
        const dy = event.clientY - pointerStart.y;
        const choice = pending;
        pending = null;
        if (!choice || dx * dx + dy * dy > clickSlop * clickSlop) {
            return;
        }
        if (choice === 'header') {
            open = !open;
            redraw();
            return;
        }
        if (choice.kind === 'up' && scroll > 0) {
            scroll -= 1;
            redraw();
            return;
        }
        if (choice.kind === 'down' && scroll + nameRows < lists.length) {
            scroll += 1;
            redraw();
            return;
        }
        if (choice.kind === 'deck' && choice.list) {
            open = false;
            if (choice.list !== current) {
                current = choice.list;
                redraw();
                deck.load(choice.list);
                return;
            }
            redraw();
        }
    };

    const onWheel = (event: WheelEvent) => {
        if (!open || !showScroll) {
            return;
        }
        const hit = rayPlane(app, event, listY);
        if (!hit || !contains(hit.x, hit.z, anchor.x, listZ, anchor.width, listDepth)) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        const next = scroll + (event.deltaY > 0 ? 1 : -1);
        scroll = Math.min(Math.max(0, next), lists.length - nameRows);
        redraw();
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    app.on('destroy', () => {
        window.removeEventListener('pointerdown', onPointerDown, true);
        window.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('wheel', onWheel, true);
        if (holding) {
            setCameraEnabled(app, true);
        }
        header.destroy();
        listPanel.destroy();
    });
};
