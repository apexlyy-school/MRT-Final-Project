import {
    AppBase,
    AppOptions,
    CameraComponentSystem,
    Color,
    ContainerHandler,
    Entity,
    FILLMODE_FILL_WINDOW,
    LightComponentSystem,
    RESOLUTION_AUTO,
    RenderComponentSystem,
    ScriptComponentSystem,
    TextureHandler,
    Vec2,
    Vec3,
    createGraphicsDevice
} from 'playcanvas';
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';

import { createBoard } from './scene/createBoard.ts';
import { mountWelcome } from './welcome.ts';
import './style.css';

const canvas = document.getElementById('application-canvas') as HTMLCanvasElement;

const device = await createGraphicsDevice(canvas);
device.maxPixelRatio = Math.min(window.devicePixelRatio, 2);

const createOptions = new AppOptions();
createOptions.graphicsDevice = device;
createOptions.componentSystems = [
    RenderComponentSystem,
    CameraComponentSystem,
    LightComponentSystem,
    ScriptComponentSystem
];
createOptions.resourceHandlers = [TextureHandler, ContainerHandler];

const app = new AppBase(canvas);
app.init(createOptions);
app.start();

// Set the canvas to fill the window and automatically change resolution to be the same as the canvas size
app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
app.setCanvasResolution(RESOLUTION_AUTO);

// Ensure canvas is resized when window changes size
const resize = () => app.resizeCanvas();
window.addEventListener('resize', resize);
app.on('destroy', () => {
    window.removeEventListener('resize', resize);
});

const background = '#122545';
app.scene.ambientLight = new Color(0.55, 0.62, 0.74);

createBoard(app);
mountWelcome();

// Start almost overhead, looking at the middle of the board. Drag to orbit.
const camera = new Entity('camera');
camera.addComponent('camera', {
    clearColor: new Color().fromString(background)
});
camera.setPosition(0, 10.4, 1.15);
app.root.addChild(camera);

const cameraScript = camera.addComponent('script');
if (!cameraScript) {
    throw new Error('Failed to create camera controls');
}
cameraScript.create(CameraControls, {
    properties: {
        enableFly: true,
        focusPoint: new Vec3(0, 0, 0.55),
        zoomRange: new Vec2(3, 16)
    }
});

const light = new Entity('light');
light.addComponent('light', {
    intensity: 0.85
});
light.setEulerAngles(90, 0, 0);
app.root.addChild(light);
