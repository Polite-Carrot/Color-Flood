/* palette.ts — what a colour index looks like.
 *
 * The generator deals in indices and knows nothing about appearance, which is
 * the only reason one generator can feed a web build, a phone build and a
 * terminal. This is the other half: index 0 is red, index 1 is orange, and so
 * on down the list.
 *
 * The hexes are the ones the sort game uses, deliberately — the two games are
 * meant to look like they came from the same place, and a player who has
 * played one should recognise the colours in the other.
 *
 * Every colour carries a letter as well as a hex. On a flood board the letter
 * is not decoration: a board printed to a terminal that cannot do colour, or
 * looked at by somebody who cannot easily tell two of them apart, still has to
 * be readable. So the palette is chosen so all ten initials differ. */

export type Colour = {
  hex: string;
  /* Shown on the cell. Unique across the palette. */
  mark: string;
  name: string;
};

export const PALETTE: Colour[] = [
  { hex: '#f5423c', mark: 'R', name: 'red' },
  { hex: '#3b7bf7', mark: 'B', name: 'blue' },
  { hex: '#ffd028', mark: 'Y', name: 'yellow' },
  { hex: '#2fc15e', mark: 'G', name: 'green' },
  { hex: '#9a53ef', mark: 'P', name: 'purple' },
  { hex: '#ff8700', mark: 'O', name: 'orange' },
  { hex: '#0ec3c6', mark: 'T', name: 'teal' },
  { hex: '#ff5aae', mark: 'M', name: 'magenta' },
  { hex: '#fbfdff', mark: 'W', name: 'white' },
  { hex: '#22c8ff', mark: 'C', name: 'cyan' },
];

/* The first six are the ones a puzzle reaches for first, and they are ordered
   so that a four-colour board is red / blue / yellow / green — the four a
   player names without thinking — rather than four neighbours off a wheel. */
export const MAX_PALETTE = PALETTE.length;

export function colour(index: number): Colour {
  const c = PALETTE[index];
  if (!c) throw new Error('no colour at index ' + index + ' — the palette holds ' + PALETTE.length);
  return c;
}

export function rgb(index: number): { r: number; g: number; b: number } {
  const h = colour(index).hex.slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/* Dark or light lettering, whichever stands out on the cell. */
export function ink(index: number): 'dark' | 'light' {
  const c = rgb(index);
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255 > 0.58 ? 'dark' : 'light';
}
