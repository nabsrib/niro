export type Vec = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

/**
 * Camera maps world coordinates to screen coordinates:
 *   screen = world * z + (x, y)
 */
export type Camera = { x: number; y: number; z: number };

export type ItemType = 'sticky' | 'rect' | 'ellipse' | 'text' | 'frame' | 'path';

export interface Item extends Box {
  id: string;
  type: ItemType;
  /** Background fill (sticky / shapes). */
  fill: string;
  /** Text color for text items; stroke color for pen paths. */
  color: string;
  text: string;
  fontSize: number;
  /**
   * Pen paths only: flat [x0, y0, x1, y1, ...] list of points, each normalized
   * to 0..1 within the item's box, so resizing the box reshapes the stroke.
   */
  points?: number[];
  /** Pen paths only: stroke width in world units. */
  strokeWidth?: number;
  /** Pen paths only: drawn with the highlighter (wide, see-through). */
  highlight?: boolean;
  /**
   * Frames only: position in the presentation order set in the slides grid
   * (lower first). Frames without one follow, in reading order.
   */
  slide?: number;
  /** Frames only: left out of the presentation (still shown in the slides grid). */
  skipSlide?: boolean;
  /** Frames only: a slide deck, whose child frames are laid out in a row as slides. */
  deck?: boolean;
}

/** A board in the boards list (its content is stored separately, under its id). */
export interface BoardMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * One end of a connector: either a free point on the canvas, or attached to an
 * item. An attached end with `side: null` floats: it meets the item's outline
 * wherever the line toward the other end crosses it.
 */
export type Endpoint =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'item'; itemId: string; side: Side | null };

export type ConnectorStyle = 'straight' | 'elbow' | 'curved';

/**
 * Point a curved connector passes through, relative to the straight line from
 * its start to its end (both as fractions of that line's length): `along` runs
 * from start (0) to end (1); `offset` is the sideways distance (positive to the
 * left of the direction of travel in screen space). Relative values keep the
 * curve's shape when the connected items move.
 */
export type Bend = { along: number; offset: number };
export type ArrowHead = 'none' | 'arrow';

export interface Connector {
  id: string;
  from: Endpoint;
  to: Endpoint;
  style: ConnectorStyle;
  stroke: string;
  strokeWidth: number;
  startArrow: ArrowHead;
  endArrow: ArrowHead;
  /** User-controlled curve shape (curved style only); absent = automatic curve. */
  bend?: Bend | null;
  /** Text shown on the line; absent or empty = no label. */
  label?: string;
  /** Where the label sits, as a fraction of the line's length from start (0) to end (1); absent = middle. */
  labelAt?: number;
  /** Label font size in world units; absent = LABEL_DEFAULTS.size. */
  labelSize?: number;
  /** Label text color; absent = LABEL_DEFAULTS.color. */
  labelColor?: string;
}

/** What the pen tool does: draw a solid stroke, draw a see-through highlight, or erase strokes. */
export type PenMode = 'pen' | 'highlighter' | 'eraser';

/** Pen strokes ('path' items) are drawn with the pen tool, not placed directly. */
export type Tool = 'select' | 'hand' | 'connector' | 'pen' | CreationTool;

export type CreationTool = Exclude<ItemType, 'path'>;

export const CREATION_TOOLS: CreationTool[] = ['sticky', 'text', 'rect', 'ellipse', 'frame'];

export function isCreationTool(tool: Tool): tool is CreationTool {
  return (CREATION_TOOLS as string[]).includes(tool);
}
