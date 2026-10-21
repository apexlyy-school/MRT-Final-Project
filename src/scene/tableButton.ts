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

const paintButton = (device: GraphicsDevice, width: number, depth: number, label: string, name: string) => {
    const pixels = 1000;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(4, Math.round(width * pixels));
    canvas.height = Math.max(4, Math.round(depth * pixels));
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error(`Failed to draw the ${name} button`);
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
    context.fillText(label, w / 2, h / 2 + 1);

    const texture = new Texture(device, {
        name,
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

export class TableButton extends Script {
    static scriptName = 'tableButton';

    originX = 0;
    originZ = 0;
    width = 1.1;
    depth = 0.38;
    onPress: (() => void) | null = null;

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
        this.onPress?.();
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

export const addTableButton = (
    parent: Entity,
    device: GraphicsDevice,
    x: number,
    z: number,
    label: string,
    name: string,
    onPress: () => void,
    width = 1.15,
    depth = 0.4
) => {
    const material = paintButton(device, width, depth, label, name);
    const mesh = Mesh.fromGeometry(device, new PlaneGeometry({
        halfExtents: new Vec2(width / 2, depth / 2),
        widthSegments: 1,
        lengthSegments: 1
    }));
    const button = new Entity(name);
    button.setLocalPosition(x, buttonY, z);
    button.addComponent('render', {
        meshInstances: [new MeshInstance(mesh, material)]
    });
    parent.addChild(button);
    const scripts = button.addComponent('script');
    if (!scripts) {
        throw new Error(`Failed to create the ${name} button`);
    }
    const created = scripts.create(TableButton, {
        properties: {
            originX: x,
            originZ: z,
            width,
            depth
        }
    });
    if (created instanceof TableButton) {
        created.onPress = onPress;
    }
};
