/**
 * Colour ramps shared by the palette sheet and the greybox bake, so both derive every shade the
 * same way (ART_BIBLE.md §6.3): five steps — shadow, core shadow, base, light, highlight —
 * shadows shifting cooler toward blue, highlights warmer toward yellow, never pure black or white.
 */

export const toRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const toHex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function hslToRgb([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
/** Move hue `amount` degrees toward `target`, the short way round. */
const shiftHue = (h, target, amount) => { const d = ((target - h + 540) % 360) - 180; return (h + Math.sign(d) * Math.min(Math.abs(d), amount) + 360) % 360; };

/** The five-step ramp for a base colour: [shadow, core shadow, base, light, highlight]. */
export function ramp(base) {
  const [h, s, l] = rgbToHsl(toRgb(base));
  const steps = [
    [shiftHue(h, 225, 14), Math.min(1, s * 1.05), l * 0.55],
    [shiftHue(h, 225, 7), s, l * 0.78],
    [h, s, l],
    [shiftHue(h, 50, 6), s * 0.95, l + (1 - l) * 0.22],
    [shiftHue(h, 50, 12), s * 0.85, l + (1 - l) * 0.42],
  ];
  return steps.map((hsl, i) => (i === 2 ? base.toLowerCase() : toHex(hslToRgb([hsl[0], hsl[1], Math.max(0.06, Math.min(0.94, hsl[2]))]))));
}
