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
    StandardMaterial,
    Texture,
    Vec2
} from 'playcanvas';
import type { GraphicsDevice } from 'playcanvas';

const markY = 0.05;
const markColor = '#c5d4e6';

/** Same dash and gap on every side, with a dash landing on each corner. */
const cornerDash = (shortSide: number, longSide: number) => {
    const period = (longSide - shortSide) / 3;
    const shortGaps = Math.max(1, Math.round(shortSide / period - 0.5));
    const dash = shortSide - shortGaps * period;
    return { dash, gap: period - dash };
};

const strokeDash = (
    context: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    dash: number,
    gap: number
) => {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const dx = (x1 - x0) / length;
    const dy = (y1 - y0) / length;
    let traveled = 0;
    while (traveled < length - 0.5) {
        const end = Math.min(length, traveled + dash);
        context.beginPath();
        context.moveTo(x0 + dx * traveled, y0 + dy * traveled);
        context.lineTo(x0 + dx * end, y0 + dy * end);
        context.stroke();
        traveled = end + gap;
    }
};

const emptySlotTexture = (device: GraphicsDevice, width: number, depth: number) => {
    const pixelsPerMeter = 1000;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * pixelsPerMeter);
    canvas.height = Math.round(depth * pixelsPerMeter);
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Failed to draw the empty slot');
    }
    const lineWidth = Math.max(2, Math.round(0.012 * pixelsPerMeter));
    context.strokeStyle = markColor;
    context.lineWidth = lineWidth;
    context.lineCap = 'butt';
    const inset = lineWidth / 2;
    const left = inset;
    const top = inset;
    const right = canvas.width - inset;
    const bottom = canvas.height - inset;
    const { dash, gap } = cornerDash(right - left, bottom - top);
    strokeDash(context, left, top, right, top, dash, gap);
    strokeDash(context, right, top, right, bottom, dash, gap);
    strokeDash(context, right, bottom, left, bottom, dash, gap);
    strokeDash(context, left, bottom, left, top, dash, gap);

    const texture = new Texture(device, {
        name: 'empty-slot',
        width: canvas.width,
        height: canvas.height,
        format: PIXELFORMAT_RGBA8,
        mipmaps: true,
        minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
        magFilter: FILTER_LINEAR,
        addressU: ADDRESS_CLAMP_TO_EDGE,
        addressV: ADDRESS_CLAMP_TO_EDGE,
        anisotropy: Math.min(8, device.maxAnisotropy)
    });
    texture.setSource(canvas);
    return texture;
};

export const addEmptySlot = (
    parent: Entity,
    device: GraphicsDevice,
    x: number,
    z: number,
    width: number,
    depth: number,
    label: string,
    name: string
) => {
    const mesh = Mesh.fromGeometry(device, new PlaneGeometry({
        halfExtents: new Vec2(width / 2, depth / 2),
        widthSegments: 1,
        lengthSegments: 1
    }));
    const material = new StandardMaterial();
    const texture = emptySlotTexture(device, width, depth);
    material.diffuseMap = texture;
    material.opacityMap = texture;
    material.opacityMapChannel = 'a';
    material.blendType = BLEND_NORMAL;
    material.useLighting = false;
    material.depthWrite = false;
    material.update();

    const mark = new Entity(name);
    mark.setLocalPosition(x, 0, z);
    parent.addChild(mark);

    const border = new Entity(`${name}-border`);
    border.setLocalPosition(0, markY, 0);
    border.addComponent('render', {
        meshInstances: [new MeshInstance(mesh, material)]
    });
    mark.addChild(border);

    const text = addZoneLabel(mark, device, 0, 0, label, `${name}-label`);
    text.setLocalPosition(0, markY + 0.002, 0);
    return mark;
};

const textMaterial = (device: GraphicsDevice, canvas: HTMLCanvasElement) => {
    const texture = new Texture(device, {
        name: 'zone-label',
        width: canvas.width,
        height: canvas.height,
        format: PIXELFORMAT_RGBA8,
        mipmaps: true,
        minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
        magFilter: FILTER_LINEAR,
        addressU: ADDRESS_CLAMP_TO_EDGE,
        addressV: ADDRESS_CLAMP_TO_EDGE,
        anisotropy: Math.min(8, device.maxAnisotropy)
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

/** Centred zone name. */
export const addZoneLabel = (parent: Entity, device: GraphicsDevice, x: number, z: number, label: string, name: string) => {
    const fontPx = 96;
    const scratch = document.createElement('canvas').getContext('2d');
    if (!scratch) {
        throw new Error('Failed to draw the zone label');
    }
    scratch.font = `${fontPx}px Arial`;
    const measured = scratch.measureText(label);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(4, Math.ceil(measured.width + fontPx));
    canvas.height = Math.ceil(fontPx * 1.35);
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Failed to draw the zone label');
    }
    context.font = `${fontPx}px Arial`;
    context.fillStyle = markColor;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, canvas.width / 2, canvas.height / 2);

    const worldHeight = 0.075;
    const worldWidth = worldHeight * (canvas.width / canvas.height);
    const mesh = Mesh.fromGeometry(device, new PlaneGeometry({
        halfExtents: new Vec2(worldWidth / 2, worldHeight / 2),
        widthSegments: 1,
        lengthSegments: 1
    }));
    const mark = new Entity(name);
    mark.setLocalPosition(x, markY, z);
    mark.addComponent('render', {
        meshInstances: [new MeshInstance(mesh, textMaterial(device, canvas))]
    });
    parent.addChild(mark);
    return mark;
};
