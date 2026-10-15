declare module 'playcanvas/scripts/esm/camera-controls.mjs' {
    import { Script } from 'playcanvas';
    import type { Vec2, Vec3 } from 'playcanvas';

    export class CameraControls extends Script {
        enableFly: boolean;
        enableOrbit: boolean;
        enablePan: boolean;
        focusPoint: Vec3;
        pitchRange: Vec2;
        yawRange: Vec2;
        zoomRange: Vec2;
    }
}
