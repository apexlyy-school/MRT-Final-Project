import type { AppBase, Entity } from 'playcanvas';

import { Vec3 } from 'playcanvas';

const minPitch = 0.35;
const maxPitch = 1.48;
const minDistance = 2.4;
const maxDistance = 14;

export const attachOrbitCamera = (app: AppBase, camera: Entity) => {
    const target = new Vec3(0, 0, 0.35);
    let yaw = 0;
    let pitch = 1.28;
    let distance = 6.4;
    let orbiting = false;
    let panning = false;
    let lastX = 0;
    let lastY = 0;

    const canvas = app.graphicsDevice.canvas;
    const right = new Vec3();
    const forward = new Vec3();

    const apply = () => {
        const cosPitch = Math.cos(pitch);
        camera.setPosition(
            target.x + distance * Math.sin(yaw) * cosPitch,
            target.y + distance * Math.sin(pitch),
            target.z + distance * Math.cos(yaw) * cosPitch
        );
        camera.lookAt(target);
    };

    const pan = (dx: number, dy: number) => {
        const world = camera.getWorldTransform();
        world.getX(right);
        world.getZ(forward);
        right.y = 0;
        forward.y = 0;
        right.normalize();
        forward.normalize();

        const scale = distance * 0.0016;
        target.add(right.mulScalar(-dx * scale));
        target.add(forward.mulScalar(-dy * scale));
    };

    canvas.addEventListener('pointerdown', (event) => {
        if (event.button === 0) {
            orbiting = true;
        } else if (event.button === 1 || event.button === 2) {
            panning = true;
        }
        lastX = event.clientX;
        lastY = event.clientY;
    });

    window.addEventListener('pointerup', () => {
        orbiting = false;
        panning = false;
    });

    window.addEventListener('pointermove', (event) => {
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        lastX = event.clientX;
        lastY = event.clientY;

        if (orbiting) {
            yaw -= dx * 0.005;
            pitch = Math.min(maxPitch, Math.max(minPitch, pitch - dy * 0.005));
            apply();
        } else if (panning) {
            pan(dx, dy);
            apply();
        }
    });

    canvas.addEventListener(
        'wheel',
        (event) => {
            event.preventDefault();
            distance = Math.min(maxDistance, Math.max(minDistance, distance * (1 + event.deltaY * 0.001)));
            apply();
        },
        { passive: false }
    );

    canvas.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });

    apply();
};
