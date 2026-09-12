import type { Rgba } from './png.mjs';

export interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface Check { readonly name: string; readonly pass: boolean; readonly detail: string }

export const FUNCTIONAL_HUES: readonly string[];
export const COLOUR_CAP: Readonly<Record<string, number>>;
export const NO_FUNCTIONAL: ReadonlySet<string>;

export function bbox(img: Rgba, threshold?: number): Box | null;
export function removeDarkMatte(img: Rgba, maxLuminance: number): { img: Rgba; cleared: number };
export function downsample(img: Rgba, region: Box, outW: number, outH: number): Rgba;
export function quantize(img: Rgba, cap: number): { img: Rgba; palette: string[] };
export function place(subject: Rgba, canvasW: number, canvasH: number, pivot: readonly [number, number]): Rgba;
export function halve(img: Rgba): Rgba;
export function contactShadow(img: Rgba, pivot: readonly [number, number]): Rgba;
export function scaleNearest(img: Rgba, factor: number): Rgba;
export function qaSheet(images: readonly Rgba[], ground?: string, gap?: number): Rgba;
export function validate(
  img: Rgba,
  opts: { canvas?: readonly [number, number]; pivot?: readonly [number, number]; category: string; halfImg?: Rgba },
): { pass: boolean; checks: Check[]; colours: number; bbox: Box | null };
