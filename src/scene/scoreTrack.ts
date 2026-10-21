import {
    ADDRESS_CLAMP_TO_EDGE,
    BLEND_ADDITIVEALPHA,
    Color,
    Entity,
    FILTER_LINEAR,
    PIXELFORMAT_RGBA8,
    Script,
    StandardMaterial,
    Texture,
    Vec3
} from 'playcanvas';
import type { GraphicsDevice } from 'playcanvas';

const scoreIdle = '#1a3d6b';
const scoreEdge = '#9aa3ad';
const scoreEdgeActive = '#7ee8c8';
const scoreEight = '#a8946c';
const scoreEightLabelGlow = '#ffe7a8';
const scoreLabel = '#e4edf6';
const scoreLabelGlow = '#d7fff6';

export const scoreRadius = 0.21;
const clickSlop = 6;
const forwardStep = 0.16;
const backStep = 0.045;
const colorEdge = new Color().fromString(scoreEdge);
const colorEdgeActive = new Color().fromString(scoreEdgeActive);
const colorEight = new Color().fromString(scoreEight);
const colorLabel = new Color().fromString(scoreLabel);
const colorLabelGlow = new Color().fromString(scoreLabelGlow);
const colorEightLabel = new Color().fromString(scoreEightLabelGlow);
const colorBlack = new Color(0, 0, 0);

type ScoreDot = {
    entity: Entity;
    distance: number;
};

type ScoreLink = {
    dots: ScoreDot[];
    solid: Entity;
    span: number;
    start: number;
    fromX: number;
    fromZ: number;
    dirX: number;
    dirZ: number;
};

type ScoreButton = {
    entity: Entity;
    material: StandardMaterial;
    label: StandardMaterial;
    edge: StandardMaterial;
    borderGlow: Entity;
    numberGlow: Entity;
    borderHome: [number, number, number];
    numberHome: [number, number, number];
    borderSize: number;
    numberSize: number;
    radius: number;
    goldEdge: boolean;
};

const createMaterial = (hex: string) => {
    const material = new StandardMaterial();
    material.diffuse.fromString(hex);
    material.update();
    return material;
};

const addDisc = (
    parent: Entity,
    name: string,
    scale: [number, number, number],
    position: [number, number, number],
    material: StandardMaterial
) => {
    const entity = new Entity(name);
    const render = entity.addComponent('render', { type: 'cylinder' });
    if (!render) {
        throw new Error(`Failed to create the ${name} render component`);
    }
    entity.setLocalScale(...scale);
    entity.setLocalPosition(...position);
    render.meshInstances[0].material = material;
    parent.addChild(entity);
    return entity;
};

const rayNear = new Vec3();
const rayFar = new Vec3();

export class ScoreTrack extends Script {
    static scriptName = 'scoreTrack';

    buttons: ScoreButton[] = [];
    links: ScoreLink[] = [];
    score = 0;

    private progress = 0;
    private target = 0;
    private pointerStart: { x: number; y: number } | null = null;

    private readonly onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) {
            return;
        }
        this.pointerStart = { x: event.clientX, y: event.clientY };
    };

    private readonly onPointerUp = (event: PointerEvent) => {
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
        this.pick(event);
    };

    initialize() {
        this.progress = 0;
        this.target = 0;
        this.applyProgress();
        const canvas = this.app.graphicsDevice.canvas;
        canvas.addEventListener('pointerdown', this.onPointerDown);
        window.addEventListener('pointerup', this.onPointerUp);
        this.on('destroy', () => {
            canvas.removeEventListener('pointerdown', this.onPointerDown);
            window.removeEventListener('pointerup', this.onPointerUp);
        });
    }

    update(dt: number) {
        if (this.progress === this.target) {
            return;
        }
        const forward = this.target > this.progress;
        const speed = 1 / (forward ? forwardStep : backStep);
        const step = speed * dt;
        this.progress = forward
            ? Math.min(this.target, this.progress + step)
            : Math.max(this.target, this.progress - step);
        this.applyProgress();
    }

    private applyProgress() {
        const progress = this.progress;
        this.score = Math.floor(progress + 1e-4);
        const head = Math.min(this.buttons.length - 1, Math.floor(progress));
        const next = Math.min(this.buttons.length - 1, head + 1);
        const along = progress - head;

        for (let i = 0; i < this.buttons.length; i++) {
            const reached = i === 0 ? 1 : clamp(progress - (i - 1), 0, 1);
            const focus = i === head ? 1 - along : i === next ? along : 0;
            const button = this.buttons[i];
            button.material.diffuse.fromString(scoreIdle);
            button.borderGlow.enabled = false;
            button.numberGlow.enabled = false;
            button.borderGlow.setLocalPosition(...button.borderHome);
            button.numberGlow.setLocalPosition(...button.numberHome);
            button.borderGlow.setLocalScale(button.borderSize, 1, button.borderSize);
            button.numberGlow.setLocalScale(button.numberSize, 1, button.numberSize);
            const numberMaterial = button.numberGlow.render?.meshInstances[0].material;
            if (numberMaterial instanceof StandardMaterial) {
                numberMaterial.opacity = focus;
                numberMaterial.update();
            }
            button.numberGlow.enabled = focus > 0.01;
            if (button.goldEdge) {
                button.label.diffuse.lerp(colorLabel, colorEightLabel, focus);
                button.edge.diffuse.copy(colorEight);
                button.edge.emissive.lerp(colorBlack, colorEight, focus);
            } else {
                button.label.diffuse.lerp(colorLabel, colorLabelGlow, focus);
                button.edge.diffuse.lerp(colorEdge, colorEdgeActive, reached);
                button.edge.emissive.lerp(colorBlack, colorEdgeActive, focus);
            }
            button.material.update();
            button.label.update();
            button.edge.update();
        }

        const from = this.buttons[head];
        const to = this.buttons[next];
        from.borderGlow.enabled = true;
        from.borderGlow.setLocalPosition(
            from.borderHome[0] + (to.borderHome[0] - from.borderHome[0]) * along,
            from.borderHome[1],
            from.borderHome[2] + (to.borderHome[2] - from.borderHome[2]) * along
        );
        const borderSize = from.borderSize + (to.borderSize - from.borderSize) * along;
        from.borderGlow.setLocalScale(borderSize, 1, borderSize);

        for (let i = 0; i < this.links.length; i++) {
            const amount = i < head ? 1 : i === head ? along : 0;
            this.setLink(this.links[i], amount);
        }
    }

    private setLink(link: ScoreLink, amount: number) {
        const grown = link.span * clamp(amount, 0, 1);
        const covered = link.start + grown;
        link.solid.enabled = grown > 0.01;
        link.solid.setLocalScale(0.02, 0.008, Math.max(grown, 0.001));
        link.solid.setLocalPosition(
            link.fromX + link.dirX * (link.start + grown / 2),
            0.046,
            link.fromZ + link.dirZ * (link.start + grown / 2)
        );
        for (let i = 0; i < link.dots.length; i++) {
            link.dots[i].entity.enabled = link.dots[i].distance > covered;
        }
    }

    /** Advance the track by one or more points, capped at the last ring. */
    gain(amount: number) {
        if (amount <= 0) {
            return;
        }
        this.target = Math.min(this.buttons.length - 1, this.target + Math.floor(amount));
    }

    /** Return the track to score 0. */
    reset() {
        this.progress = 0;
        this.target = 0;
        this.applyProgress();
    }

    private pick(event: PointerEvent) {
        const cameraNode = this.app.root.findByName('camera');
        const camera = cameraNode instanceof Entity ? cameraNode.camera : null;
        const canvas = this.app.graphicsDevice.canvas;
        if (!camera || !(canvas instanceof HTMLCanvasElement)) {
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        camera.screenToWorld(x, y, camera.nearClip, rayNear);
        camera.screenToWorld(x, y, camera.farClip, rayFar);

        const dy = rayFar.y - rayNear.y;
        if (Math.abs(dy) < 1e-5) {
            return;
        }
        const t = (0.055 - rayNear.y) / dy;
        if (t < 0 || t > 1) {
            return;
        }
        const hitX = rayNear.x + (rayFar.x - rayNear.x) * t;
        const hitZ = rayNear.z + (rayFar.z - rayNear.z) * t;

        let closest = -1;
        let closestDist = Infinity;
        for (let i = 0; i < this.buttons.length; i++) {
            const button = this.buttons[i];
            const center = button.entity.getPosition();
            const dist = Math.hypot(hitX - center.x, hitZ - center.z);
            if (dist <= button.radius && dist < closestDist) {
                closest = i;
                closestDist = dist;
            }
        }
        if (closest < 0 || closest === this.target) {
            return;
        }
        this.target = closest;
    }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const digitTexture = (device: GraphicsDevice, digit: number) => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Failed to draw the score numbers');
    }
    context.clearRect(0, 0, size, size);
    context.fillStyle = '#ffffff';
    context.font = '700 96px Arial, Helvetica, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(digit), size / 2, size / 2 + 4);

    const texture = new Texture(device, {
        name: `score-${digit}`,
        width: size,
        height: size,
        format: PIXELFORMAT_RGBA8,
        mipmaps: false,
        minFilter: FILTER_LINEAR,
        magFilter: FILTER_LINEAR,
        addressU: ADDRESS_CLAMP_TO_EDGE,
        addressV: ADDRESS_CLAMP_TO_EDGE
    });
    texture.setSource(canvas);
    return texture;
};

const canvasTexture = (device: GraphicsDevice, name: string, canvas: HTMLCanvasElement) => {
    const texture = new Texture(device, {
        name,
        width: canvas.width,
        height: canvas.height,
        format: PIXELFORMAT_RGBA8,
        mipmaps: false,
        minFilter: FILTER_LINEAR,
        magFilter: FILTER_LINEAR,
        addressU: ADDRESS_CLAMP_TO_EDGE,
        addressV: ADDRESS_CLAMP_TO_EDGE
    });
    texture.setSource(canvas);
    return texture;
};

// Soft ring whose bright band lines up with a button's outer border.
const ringGlowTexture = (device: GraphicsDevice) => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Failed to draw the score glow');
    }
    const image = context.createImageData(size, size);
    const peak = size * 0.32;
    const sigma = size * 0.055;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const distance = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5);
            const falloff = (distance - peak) / sigma;
            const alpha = Math.exp(-falloff * falloff) * 0.28;
            const index = (y * size + x) * 4;
            image.data[index] = 255;
            image.data[index + 1] = 255;
            image.data[index + 2] = 255;
            image.data[index + 3] = Math.round(alpha * 255);
        }
    }
    context.putImageData(image, 0, 0);
    return canvasTexture(device, 'score-ring-glow', canvas);
};

const digitGlowTexture = (device: GraphicsDevice, digit: number) => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Failed to draw the score glow');
    }
    context.clearRect(0, 0, size, size);
    context.fillStyle = '#ffffff';
    context.font = '700 96px Arial, Helvetica, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.filter = 'blur(11px)';
    context.globalAlpha = 0.35;
    context.fillText(String(digit), size / 2, size / 2 + 4);
    return canvasTexture(device, `score-glow-${digit}`, canvas);
};

const addGlow = (
    parent: Entity,
    name: string,
    texture: Texture,
    x: number,
    z: number,
    size: number,
    y: number,
    color: string
) => {
    const material = new StandardMaterial();
    material.diffuseMap = texture;
    material.opacityMap = texture;
    material.opacityMapChannel = 'a';
    material.blendType = BLEND_ADDITIVEALPHA;
    material.depthWrite = false;
    material.useLighting = false;
    material.diffuse.fromString(color);
    material.update();

    const entity = new Entity(name);
    const render = entity.addComponent('render', { type: 'plane' });
    if (!render) {
        throw new Error(`Failed to create the ${name} glow`);
    }
    entity.setLocalScale(size, 1, size);
    entity.setLocalPosition(x, y, z);
    entity.enabled = false;
    render.meshInstances[0].material = material;
    parent.addChild(entity);
    return entity;
};

const addLabel = (
    parent: Entity,
    digit: number,
    x: number,
    z: number,
    device: GraphicsDevice,
    size: number
) => {
    const material = new StandardMaterial();
    const texture = digitTexture(device, digit);
    material.diffuseMap = texture;
    material.opacityMap = texture;
    material.opacityMapChannel = 'a';
    material.alphaTest = 0.4;
    material.useLighting = false;
    material.diffuse.fromString(scoreLabel);
    material.update();

    const entity = new Entity(`score-label-${digit}`);
    const render = entity.addComponent('render', { type: 'plane' });
    if (!render) {
        throw new Error(`Failed to create the score ${digit} label`);
    }
    entity.setLocalScale(size, 1, size);
    entity.setLocalPosition(x, 0.075, z);
    render.meshInstances[0].material = material;
    parent.addChild(entity);
    return material;
};

// Offsets from the left battlefield's near-left corner, measured from the match screen.
// Even scores sit on the left, odd scores on the right, and 8 is centered above them.
const scoreOffsets: [number, number][] = [
    [-0.983, 1.168],
    [-0.362, 0.852],
    [-0.983, 0.513],
    [-0.359, 0.18],
    [-0.983, -0.153],
    [-0.36, -0.486],
    [-0.986, -0.809],
    [-0.36, -1.16],
    [-0.671, -1.86]
];

// Midpoint of the left and right columns, used to center the track on the nameplate.
export const scoreColumnMidOffset = (scoreOffsets[0][0] + scoreOffsets[1][0]) / 2;

export const addScoreTrack = (
    parent: Entity,
    device: GraphicsDevice,
    anchor: { left: number; near: number }
) => {
    const track = new Entity('score-track');
    parent.addChild(track);

    const buttons: ScoreButton[] = [];
    const centers: { x: number; z: number; radius: number }[] = [];
    const ringGlow = ringGlowTexture(device);

    for (let i = 0; i < scoreOffsets.length; i++) {
        const [dx, dz] = scoreOffsets[i];
        const x = anchor.left + dx;
        const z = anchor.near + dz;
        // Score 8 is larger and rests with a gold outer line. The others rest dull grey.
        const scale = i === scoreOffsets.length - 1 ? 1.73 : 1;
        const goldEdge = scale !== 1;
        const edge = createMaterial(goldEdge ? scoreEight : scoreEdge);
        addDisc(track, `score-edge-${i}`, [0.46 * scale, 0.008, 0.46 * scale], [x, 0.043, z], edge);
        const thin = (0.46 - 0.42) / 2;
        const bandDiameter = goldEdge ? (0.23 * scale - thin) * 2 : 0.42 * scale;
        const faceDiameter = goldEdge ? bandDiameter : 0.3 * scale;
        const material = createMaterial(scoreIdle);
        addDisc(track, `score-ring-${i}`, [bandDiameter, 0.012, bandDiameter], [x, 0.046, z], material);
        const entity = addDisc(track, `score-${i}`, [faceDiameter, 0.02, faceDiameter], [x, 0.055, z], material);
        const glowColor = goldEdge ? scoreEight : scoreEdgeActive;
        const borderSize = 0.72 * scale;
        const numberSize = (goldEdge ? 0.52 : 0.38) * scale;
        const borderGlow = addGlow(track, `score-border-glow-${i}`, ringGlow, x, z, borderSize, 0.068, glowColor);
        const numberGlow = addGlow(
            track,
            `score-number-glow-${i}`,
            digitGlowTexture(device, i),
            x,
            z,
            numberSize,
            0.072,
            glowColor
        );
        const label = addLabel(track, i, x, z, device, (goldEdge ? 0.34 : 0.24) * scale);
        const radius = 0.23 * scale;
        centers.push({ x, z, radius });
        buttons.push({
            entity,
            material,
            label,
            edge,
            borderGlow,
            numberGlow,
            borderHome: [x, 0.068, z],
            numberHome: [x, 0.072, z],
            borderSize,
            numberSize,
            radius,
            goldEdge
        });
    }

    const links = addScoreLinks(track, centers);

    const scripts = track.addComponent('script');
    if (!scripts) {
        throw new Error('Failed to create the score track');
    }
    scripts.create(ScoreTrack, { properties: { buttons, links } });
};

// Dotted while resting. A highlighted step swaps its dots for one solid cyan bar.
const addScoreLinks = (track: Entity, centers: { x: number; z: number; radius: number }[]) => {
    const dot = 0.03;
    const margin = 0.018;
    const targetPitch = 0.05;
    const links: ScoreLink[] = [];
    const solidMaterial = createMaterial(scoreEdgeActive);

    for (let i = 0; i < centers.length - 1; i++) {
        const from = centers[i];
        const to = centers[i + 1];
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const length = Math.hypot(dx, dz);
        const start = from.radius + margin;
        const end = length - to.radius - margin;
        const span = end - start;
        const count = span < dot ? 0 : Math.max(1, Math.min(4, Math.round(span / targetPitch)));
        const step = count <= 1 ? 0 : (span - dot) / (count - 1);
        const dotsRoot = new Entity(`score-dots-${i}`);
        track.addChild(dotsRoot);
        const material = createMaterial(scoreEdge);
        const dots: ScoreDot[] = [];
        for (let n = 0; n < count; n++) {
            const distance = start + dot / 2 + n * step;
            const entity = addDisc(
                dotsRoot,
                `score-link-${i}-${n}`,
                [dot, 0.008, dot],
                [from.x + (dx / length) * distance, 0.046, from.z + (dz / length) * distance],
                material
            );
            dots.push({ entity, distance });
        }

        const solid = new Entity(`score-solid-${i}`);
        const render = solid.addComponent('render', { type: 'box' });
        if (!render) {
            throw new Error(`Failed to create the score ${i} link`);
        }
        solid.setLocalScale(0.02, 0.008, Math.max(span, 0.001));
        solid.setLocalPosition(from.x, 0.046, from.z);
        solid.lookAt(to.x, 0.046, to.z);
        solid.enabled = false;
        render.meshInstances[0].material = solidMaterial;
        track.addChild(solid);
        links.push({
            dots,
            solid,
            span: Math.max(span, 0),
            start,
            fromX: from.x,
            fromZ: from.z,
            dirX: dx / length,
            dirZ: dz / length
        });
    }

    return links;
};
