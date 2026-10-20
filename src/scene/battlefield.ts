import type { Entity, GraphicsDevice } from 'playcanvas';

import { createStaticCard } from './playableCard.ts';

type BattlefieldSeat = {
    board: Entity;
    device: GraphicsDevice;
    x: number;
    z: number;
    width: number;
    depth: number;
    blankUrl: string;
    label: Entity | null;
    card: Entity | null;
};

let player: BattlefieldSeat | null = null;

/**
 * Landscape battlefield card. Riftcodex battlefield art is already sideways, so the mesh is
 * wide on X and short on Z with no yaw. Portrait blank backs are rotated to match.
 */
export const addBattlefield = (
    parent: Entity,
    device: GraphicsDevice,
    x: number,
    z: number,
    width: number,
    depth: number,
    artUrl: string,
    name: string,
    blank = false
) => {
    return createStaticCard(parent, device, x, z, width, depth, artUrl, name, blank);
};

/** The player's battlefield seat. Starts on the blank back and updates when a deck loads. */
export const mountPlayerBattlefield = (
    board: Entity,
    device: GraphicsDevice,
    x: number,
    z: number,
    width: number,
    depth: number,
    blankUrl: string,
    label: Entity | null
) => {
    player = {
        board,
        device,
        x,
        z,
        width,
        depth,
        blankUrl,
        label,
        card: null
    };
    showPlayerBattlefield(null);
};

/** Show a chosen battlefield face, or the blank back when art is missing. */
export const showPlayerBattlefield = (artUrl: string | null) => {
    if (!player) {
        return;
    }
    const blank = !artUrl;
    player.card?.destroy();
    player.card = addBattlefield(
        player.board,
        player.device,
        player.x,
        player.z,
        player.width,
        player.depth,
        artUrl ?? player.blankUrl,
        'battlefield-1-art',
        blank
    );
    if (player.label) {
        player.label.enabled = false;
    }
};
