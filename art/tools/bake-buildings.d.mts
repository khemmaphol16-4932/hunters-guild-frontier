import type { Rgba } from './png.mjs';

export const ROTATIONS: readonly [0, 90, 180, 270];
export function bake(buildingId: string, tierKey: string, rot: 0 | 90 | 180 | 270): { img: Rgba; pivot: [number, number]; footprint: [number, number] };
