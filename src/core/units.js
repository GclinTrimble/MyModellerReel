// Display units and precision (#52). The model and every command stay in metres; this is how lengths are shown.
export const DISPLAY = ['auto', 'mm', 'cm', 'm', 'in', 'ft', 'ft-in'];

const fixed = (x, p) => {
  const s = x.toFixed(p);
  return s === `-${(0).toFixed(p)}` ? s.slice(1) : s;
};

/** 3.2 → "3.200 m", "3200 mm", "10' 6 1/8\"" … precision: decimals, or the inch fraction for ft-in (16 → 1/16"). */
export function formatLength(m, { unit = 'auto', precision } = {}) {
  if (!Number.isFinite(m)) return '–';
  switch (unit) {
    case 'mm':
      return `${fixed(m * 1000, precision ?? 0)} mm`;
    case 'cm':
      return `${fixed(m * 100, precision ?? 1)} cm`;
    case 'm':
      return `${fixed(m, precision ?? 3)} m`;
    case 'in':
      return `${fixed(m / 0.0254, precision ?? 2)}"`;
    case 'ft':
      return `${fixed(m / 0.3048, precision ?? 3)}'`;
    case 'ft-in': {
      const den = precision && precision > 1 ? precision : 16;
      const sign = m < 0 ? '-' : '';
      let ticks = Math.round((Math.abs(m) / 0.0254) * den); // whole 1/den inches
      const ft = Math.floor(ticks / (12 * den));
      ticks -= ft * 12 * den;
      const inch = Math.floor(ticks / den);
      let num = ticks - inch * den;
      let d = den;
      while (num && num % 2 === 0) (num /= 2), (d /= 2);
      return `${sign}${ft}' ${inch}${num ? ` ${num}/${d}` : ''}"`;
    }
    default:
      return Math.abs(m) < 1 ? `${Math.round(m * 1000)} mm` : `${fixed(m, precision ?? 3)} m`;
  }
}

/** Area in the matching unit. */
export function formatArea(m2, { unit = 'auto', precision } = {}) {
  if (unit === 'ft' || unit === 'ft-in' || unit === 'in') return `${fixed(m2 / 0.09290304, precision ?? 1)} ft²`;
  return `${fixed(m2, precision ?? 2)} m²`;
}
