export type ColorKey =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'purple'
  | 'pink';

export const COLOR_KEYS: ColorKey[] = [
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'pink',
];

export const COLOR_HEX: Record<ColorKey, number> = {
  red: 0xff5468,
  orange: 0xff9b51,
  yellow: 0xffd166,
  green: 0x4dd17a,
  cyan: 0x4ed8d1,
  blue: 0x4a8fff,
  purple: 0xb978ff,
  pink: 0xff7ac0,
};

export const COLOR_HEX_STR: Record<ColorKey, string> = Object.fromEntries(
  Object.entries(COLOR_HEX).map(([k, v]) => [k, '#' + v.toString(16).padStart(6, '0')])
) as Record<ColorKey, string>;

export const COLOR_DARK: Record<ColorKey, number> = {
  red: 0x8c2231,
  orange: 0x8c4a1f,
  yellow: 0x9c7c2c,
  green: 0x217340,
  cyan: 0x1f7370,
  blue: 0x1f4a99,
  purple: 0x6b3a9e,
  pink: 0x99386b,
};
