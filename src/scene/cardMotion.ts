import type { AppBase, Entity } from 'playcanvas';

const minDuration = 0.14;
const maxDuration = 0.32;
const secondsPerUnit = 0.11;

type Slide = {
    fromX: number;
    fromY: number;
    fromZ: number;
    toX: number;
    toY: number;
    toZ: number;
    elapsed: number;
    duration: number;
};

const slides = new Map<Entity, Slide>();

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Slides cards between zones. A drag cancels the slide so the card can follow the pointer. */
export const bindCardMotion = (app: AppBase) => {
    app.on('update', (dt: number) => {
        if (slides.size === 0) {
            return;
        }
        for (const [card, slide] of slides) {
            slide.elapsed += dt;
            const t = Math.min(1, slide.elapsed / slide.duration);
            const eased = easeOut(t);
            card.setLocalPosition(
                slide.fromX + (slide.toX - slide.fromX) * eased,
                slide.fromY + (slide.toY - slide.fromY) * eased,
                slide.fromZ + (slide.toZ - slide.fromZ) * eased
            );
            if (t >= 1) {
                slides.delete(card);
            }
        }
    });
};

export const cancelCardMotion = (card: Entity) => {
    slides.delete(card);
};

export const moveCardTo = (card: Entity, x: number, y: number, z: number) => {
    const position = card.getLocalPosition();
    const distance = Math.hypot(x - position.x, y - position.y, z - position.z);
    if (distance < 0.02) {
        slides.delete(card);
        card.setLocalPosition(x, y, z);
        return;
    }
    slides.set(card, {
        fromX: position.x,
        fromY: position.y,
        fromZ: position.z,
        toX: x,
        toY: y,
        toZ: z,
        elapsed: 0,
        duration: Math.min(maxDuration, Math.max(minDuration, distance * secondsPerUnit))
    });
};
