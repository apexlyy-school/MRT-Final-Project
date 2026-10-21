import {
    BLEND_NORMAL,
    Color,
    Entity,
    StandardMaterial,
    Vec3
} from 'playcanvas';
import type { AppBase } from 'playcanvas';

import { CardChampion } from './scene/champion.ts';
import { CardDeck } from './scene/deck.ts';
import { CardHand } from './scene/hand.ts';
import { resetMatch } from './scene/reset.ts';

const defaultDeckName = 'Select Deck';
const markerY = 0.09;
const markerColor = '#7ee8c8';
const worldPoint = new Vec3();
const screenPoint = new Vec3();

type CalloutSide = 'left' | 'right' | 'above';

type TutorialStep = {
    target: string;
    title: string;
    body: string;
};

type ZoneAnchor = {
    x: number;
    y: number;
    z: number;
    width: number;
    depth: number;
    side: CalloutSide;
};

const steps: TutorialStep[] = [
    {
        target: 'deck',
        title: 'Main deck',
        body: 'This is your main deck. We start with 4 cards in our starting hand and draw 1 card at the start of every turn.'
    },
    {
        target: 'rune-deck',
        title: 'Rune deck',
        body: 'This is your rune deck. Runes are what we use to pay for the energy and power cost of our cards. At the start of every turn we channel 2 runes from the top of our rune deck.'
    },
    {
        target: 'hand',
        title: 'Hand',
        body: 'This is your hand. We can use energy and power from our runes to play cards from here onto the board.'
    },
    {
        target: 'rune-area',
        title: 'Rune area',
        body: 'Your channeled runes sit here. Exhaust them (by tapping them) to generate energy, and recycle them (right click) to generate power.'
    },
    {
        target: 'base',
        title: 'Base',
        body: 'This is your base. Units and gear you play usually enter here.'
    },
    {
        target: 'chosen-legend',
        title: 'Chosen legend',
        body: 'This is your chosen legend. It defines your deck and stays in this zone. Some legends have an ability that can be activated by exhausting them, whereas others have passive effects.'
    },
    {
        target: 'chosen-champion',
        title: 'Chosen champion',
        body: 'This is your chosen champion. It sits here until you are ready to play it, acting as an extra card in your hand.'
    }
];

const boardOf = (app: AppBase) => {
    const board = app.root.findByName('board');
    return board instanceof Entity ? board : null;
};

const targetAnchor = (app: AppBase, name: string): ZoneAnchor | null => {
    if (name === 'chosen-legend') {
        const deck = CardDeck.mainPile();
        if (!deck?.anchorLegend) {
            return null;
        }
        return {
            x: deck.originX,
            y: markerY,
            z: deck.legendZ,
            width: deck.width,
            depth: deck.depth,
            side: 'left'
        };
    }

    const board = boardOf(app);
    const found = board?.findByName(name);
    if (!(found instanceof Entity) || !found.script) {
        return null;
    }

    const deck = found.script.get('cardDeck');
    if (deck instanceof CardDeck) {
        return {
            x: deck.originX,
            y: markerY,
            z: deck.originZ,
            width: deck.width,
            depth: deck.depth,
            side: name === 'deck' ? 'left' : 'right'
        };
    }

    const hand = found.script.get('cardHand');
    if (hand instanceof CardHand) {
        return {
            x: (hand.left + hand.right) / 2,
            y: markerY,
            z: hand.centerZ,
            width: hand.right - hand.left,
            depth: hand.zoneDepth,
            side: 'above'
        };
    }

    const champion = found.script.get('cardChampion');
    if (champion instanceof CardChampion) {
        return {
            x: champion.originX,
            y: markerY,
            z: champion.originZ,
            width: champion.width,
            depth: champion.depth,
            side: 'right'
        };
    }

    return null;
};

const canStartTutorial = () => {
    const name = CardDeck.mainPile()?.activeName() ?? null;
    return Boolean(name && name !== defaultDeckName);
};

const addZoneMarker = (board: Entity, x: number, z: number, width: number, depth: number) => {
    const material = new StandardMaterial();
    material.diffuse = new Color().fromString(markerColor);
    material.emissive = new Color().fromString(markerColor);
    material.opacity = 0.45;
    material.blendType = BLEND_NORMAL;
    material.useLighting = false;
    material.depthWrite = false;
    material.update();

    const marker = new Entity('tutorial-marker');
    marker.setLocalPosition(x, markerY, z);
    marker.setLocalScale(width + 0.16, 0.02, depth + 0.16);
    const render = marker.addComponent('render', { type: 'box' });
    if (!render) {
        throw new Error('Failed to create the tutorial marker');
    }
    render.meshInstances[0].material = material;
    board.addChild(marker);
    return marker;
};

/** Top-left tutorial control with screen callouts pinned to table zones. */
export const mountTutorial = (app: AppBase) => {
    let active = false;
    let step = 0;
    let marker: Entity | null = null;
    let follow: (() => void) | null = null;

    const toggle = document.createElement('button');
    toggle.className = 'tutorial-toggle';
    toggle.type = 'button';
    document.body.append(toggle);

    const callout = document.createElement('div');
    callout.className = 'tutorial-callout';
    callout.hidden = true;
    const title = document.createElement('h2');
    title.className = 'tutorial-callout-title';
    const body = document.createElement('p');
    body.className = 'tutorial-callout-body';
    const footer = document.createElement('div');
    footer.className = 'tutorial-callout-footer';
    const progress = document.createElement('span');
    progress.className = 'tutorial-callout-progress';
    const next = document.createElement('button');
    next.className = 'tutorial-callout-next';
    next.type = 'button';
    next.textContent = 'Next';
    footer.append(progress, next);
    callout.append(title, body, footer);
    document.body.append(callout);

    const stopFollow = () => {
        if (follow) {
            app.off('update', follow);
            follow = null;
        }
    };

    const clearMarker = () => {
        marker?.destroy();
        marker = null;
    };

    const hideCallout = () => {
        callout.hidden = true;
        stopFollow();
        clearMarker();
    };

    const placeCallout = (targetName: string) => {
        const cameraNode = app.root.findByName('camera');
        const camera = cameraNode instanceof Entity ? cameraNode.camera : null;
        const canvas = app.graphicsDevice.canvas;
        const anchor = targetAnchor(app, targetName);
        if (!camera || !(canvas instanceof HTMLCanvasElement) || !anchor) {
            return;
        }
        if (anchor.side === 'above') {
            worldPoint.set(anchor.x, anchor.y, anchor.z - anchor.depth / 2);
        } else {
            const outward = anchor.side === 'left' ? -1 : 1;
            worldPoint.set(anchor.x + outward * (anchor.width / 2), anchor.y, anchor.z);
        }
        // clientRect CSS pixels (same space as screenToWorld), not canvas.width backing-store pixels.
        camera.worldToScreen(worldPoint, screenPoint);
        const rect = canvas.getBoundingClientRect();
        callout.style.left = `${rect.left + screenPoint.x}px`;
        callout.style.top = `${rect.top + screenPoint.y}px`;
        callout.classList.toggle('tutorial-callout-left', anchor.side === 'left');
        callout.classList.toggle('tutorial-callout-right', anchor.side === 'right');
        callout.classList.toggle('tutorial-callout-above', anchor.side === 'above');
    };

    const syncToggle = () => {
        if (active) {
            toggle.textContent = 'Stop Tutorial';
            toggle.disabled = false;
            toggle.classList.add('tutorial-toggle-active');
            return;
        }
        toggle.textContent = 'Tutorial';
        toggle.classList.remove('tutorial-toggle-active');
        toggle.disabled = !canStartTutorial();
    };

    const endTutorial = (reset: boolean) => {
        active = false;
        step = 0;
        hideCallout();
        if (reset) {
            const board = boardOf(app);
            if (board) {
                resetMatch(board);
            }
        }
        syncToggle();
    };

    const showStep = () => {
        const board = boardOf(app);
        const current = steps[step];
        if (!board || !current) {
            endTutorial(false);
            return;
        }
        const anchor = targetAnchor(app, current.target);
        if (!anchor) {
            endTutorial(false);
            return;
        }

        clearMarker();
        marker = addZoneMarker(board, anchor.x, anchor.z, anchor.width, anchor.depth);

        title.textContent = current.title;
        body.textContent = current.body;
        progress.textContent = `${step + 1} / ${steps.length}`;
        next.textContent = step >= steps.length - 1 ? 'Done' : 'Next';
        callout.hidden = false;
        placeCallout(current.target);
        stopFollow();
        follow = () => {
            placeCallout(current.target);
        };
        app.on('update', follow);
    };

    const startTutorial = () => {
        if (!canStartTutorial()) {
            return;
        }
        const board = boardOf(app);
        if (!board) {
            return;
        }
        resetMatch(board, { autoBattlefield: true, openingDraw: true });
        active = true;
        step = 0;
        syncToggle();
        showStep();
    };

    toggle.addEventListener('click', () => {
        if (active) {
            endTutorial(true);
            return;
        }
        startTutorial();
    });

    next.addEventListener('click', () => {
        if (!active) {
            return;
        }
        if (step >= steps.length - 1) {
            endTutorial(false);
            return;
        }
        step += 1;
        showStep();
    });

    const block = (event: Event) => {
        event.stopPropagation();
    };
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove', 'wheel'] as const) {
        toggle.addEventListener(type, block);
        callout.addEventListener(type, block);
    }

    CardDeck.onDeckChange(syncToggle);
    syncToggle();
};
