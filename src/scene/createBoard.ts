import { Entity, StandardMaterial } from 'playcanvas';
import type { AppBase } from 'playcanvas';

import { addDeck } from './deck.ts';
import { addHand } from './hand.ts';
import { addScoreTrack, scoreColumnMidOffset, scoreRadius } from './scoreTrack.ts';

// Colors sampled from the Rift Atlas match screen: navy field, slate zone lines, teal accent.
const boardColor = '#1c355c';
const zoneFill = '#1a3258';
const zoneLine = '#5d7598';
const zoneCorner = '#93abc8';
const blankCard = '#e4edf6';

const createMaterial = (hex: string) => {
    const material = new StandardMaterial();
    material.diffuse.fromString(hex);
    material.update();
    return material;
};

type RenderType = 'box' | 'cylinder';

const addMesh = (
    parent: Entity,
    name: string,
    type: RenderType,
    scale: [number, number, number],
    position: [number, number, number],
    hex: string
) => {
    const entity = new Entity(name);
    const render = entity.addComponent('render', { type });
    if (!render) {
        throw new Error(`Failed to create the ${name} render component`);
    }
    entity.setLocalScale(...scale);
    entity.setLocalPosition(...position);
    render.meshInstances[0].material = createMaterial(hex);
    parent.addChild(entity);
    return entity;
};

const addZone = (
    parent: Entity,
    name: string,
    centerX: number,
    centerZ: number,
    width: number,
    depth: number,
    corner = 0.36
) => {
    const y = 0.05;
    const thickness = Math.min(0.02, width * 0.025);
    const height = 0.012;

    addMesh(parent, `${name}-fill`, 'box', [width, 0.006, depth], [centerX, 0.044, centerZ], zoneFill);

    const edges: [number, number, number, number][] = [
        [centerX, centerZ - depth / 2, width, thickness],
        [centerX, centerZ + depth / 2, width, thickness],
        [centerX - width / 2, centerZ, thickness, depth],
        [centerX + width / 2, centerZ, thickness, depth]
    ];
    for (const [x, z, scaleX, scaleZ] of edges) {
        addMesh(parent, `${name}-edge`, 'box', [scaleX, height, scaleZ], [x, y, z], zoneLine);
    }

    const corners = [
        [centerX - width / 2, centerZ - depth / 2, 1, 1],
        [centerX + width / 2, centerZ - depth / 2, -1, 1],
        [centerX - width / 2, centerZ + depth / 2, 1, -1],
        [centerX + width / 2, centerZ + depth / 2, -1, -1]
    ] as const;
    for (const [x, z, signX, signZ] of corners) {
        addMesh(
            parent,
            `${name}-corner-x`,
            'box',
            [corner, height + 0.004, thickness * 1.6],
            [x + signX * (corner / 2), y + 0.003, z],
            zoneCorner
        );
        addMesh(
            parent,
            `${name}-corner-z`,
            'box',
            [thickness * 1.6, height + 0.004, corner],
            [x, y + 0.003, z + signZ * (corner / 2)],
            zoneCorner
        );
    }
};

const cardWidth = 0.7;
const cardDepth = 1.02;

const addCard = (parent: Entity, name: string, x: number, z: number, hex: string) => {
    return addMesh(parent, name, 'box', [cardWidth, 0.025, cardDepth], [x, 0.062, z], hex);
};

const cardFit = 0.1;

const addCardZone = (parent: Entity, name: string, x: number, z: number) => {
    addZone(parent, name, x, z, cardWidth + cardFit, cardDepth + cardFit, 0.12);
};

export const createBoard = (app: AppBase) => {
    const board = new Entity('board');
    app.root.addChild(board);

    addMesh(board, 'playmat', 'box', [15.2, 0.08, 8.8], [0, 0, 0], boardColor);

    // Positive Z is the near side, where the local player sits.
    // Rune and base share the legend's Z so their centres line up; their X still clears a tapped legend.
    const fieldShift = 0.7;
    const zoneWidth = 3.35;
    const leftZoneX = -1.85 - fieldShift;
    const rightZoneX = 1.85 - fieldShift;

    const playerZoneDepth = cardDepth + cardFit;
    // Identity stays on the old battlefield footprint so the cards do not move with the fields.
    const anchoredFieldZ = -0.15;
    const anchoredFieldDepth = 2.25;
    const zoneGap = 0.1;
    const playerZoneZ = anchoredFieldZ + anchoredFieldDepth / 2 + zoneGap + playerZoneDepth / 2;
    const playerNear = playerZoneZ + playerZoneDepth / 2;
    const baseRight = rightZoneX + zoneWidth / 2;
    const tappedHalfWidth = cardDepth / 2;
    const legendX = baseRight + tappedHalfWidth + 0.28;
    // Champion stays just clear of a tapped legend, and is centered on the trash. Legend stays on the deck.
    const identityGap = 0.12;
    const championX = legendX + tappedHalfWidth + identityGap + cardWidth / 2;
    const identityZ = playerNear - 0.02;
    const pileZ = identityZ + cardDepth / 2 + 0.14 + (cardDepth + cardFit) / 2;
    const deckRight = legendX + (cardWidth + cardFit) / 2;

    // Grow the battlefields toward the player. The far edge stays put; the near edge sits just above rune and base.
    const battlefieldFar = anchoredFieldZ - anchoredFieldDepth / 2;
    const battlefieldNear = identityZ - playerZoneDepth / 2 - zoneGap;
    const battlefieldDepth = battlefieldNear - battlefieldFar;
    const battlefieldZ = (battlefieldNear + battlefieldFar) / 2;

    // Both battlefields share one width. The gutter is small, and the right edge lines up with the deck.
    const battlefieldGap = 0.12;
    const battlefieldLeft = leftZoneX - zoneWidth / 2;
    const battlefieldWidth = (deckRight - battlefieldLeft - battlefieldGap) / 2;
    const leftFieldX = battlefieldLeft + battlefieldWidth / 2;
    const rightFieldX = deckRight - battlefieldWidth / 2;

    addZone(board, 'battlefield-left', leftFieldX, battlefieldZ, battlefieldWidth, battlefieldDepth);
    addZone(board, 'battlefield-right', rightFieldX, battlefieldZ, battlefieldWidth, battlefieldDepth);

    // Widen the base to the left only. Its right edge still clears a tapped legend.
    const runeRight = leftZoneX + zoneWidth / 2;
    const baseLeft = runeRight + battlefieldGap;
    const baseWidth = baseRight - baseLeft;
    const baseX = (baseLeft + baseRight) / 2;
    addZone(board, 'rune-area', leftZoneX, identityZ, zoneWidth, playerZoneDepth);
    addZone(board, 'base', baseX, identityZ, baseWidth, playerZoneDepth);

    const plateX = -5.15;
    addScoreTrack(board, app.graphicsDevice, {
        left: plateX - scoreColumnMidOffset,
        near: battlefieldNear - 0.08
    });

    addCard(board, 'chosen-legend', legendX, identityZ, blankCard);
    addCard(board, 'chosen-champion', championX, identityZ, blankCard);

    addCardZone(board, 'deck', legendX, pileZ);
    addDeck(board, app.graphicsDevice, legendX, pileZ, cardWidth, cardDepth);
    addCardZone(board, 'trash', championX, pileZ);
    const runeDeckX = -3.45;
    addCardZone(board, 'rune-deck', runeDeckX, pileZ);

    const pileHalf = (cardWidth + cardFit) / 2;
    const handMargin = 0.16;
    const handLeft = runeDeckX + pileHalf + handMargin;
    const handRight = legendX - pileHalf - handMargin;
    const handDepth = cardDepth + cardFit;
    addZone(board, 'hand', (handLeft + handRight) / 2, pileZ, handRight - handLeft, handDepth);
    addHand(board, handLeft, handRight, pileZ, handDepth, cardWidth);

    // Sit the nameplate just below score 0, clear of the zigzag track.
    const plateDepth = 0.55;
    const plateZ = battlefieldNear + 1.168 + scoreRadius + 0.08 + plateDepth / 2;
    addMesh(board, 'player-plate', 'box', [1.5, 0.02, plateDepth], [plateX, 0.05, plateZ], '#10243f');
    addMesh(board, 'opponent-plate', 'box', [1.7, 0.02, 0.55], [4.85, 0.05, -3.05], '#10243f');
};
