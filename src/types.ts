export type Vec = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

/**
 * Camera maps world coordinates to screen coordinates:
 *   screen = world * z + (x, y)
 */
export type Camera = { x: number; y: number; z: number };

export type ItemType = 'sticky' | 'rect' | 'ellipse' | 'text' | 'frame';

export interface Item extends Box {
  id: string;
  type: ItemType;
  /** Background fill (sticky / shapes). */
  fill: string;
  /** Text color (used by text items; others derive it from fill). */
  color: string;
  text: string;
  fontSize: number;
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
}

export type Tool = 'select' | 'hand' | 'connector' | ItemType;

export const CREATION_TOOLS: ItemType[] = ['sticky', 'text', 'rect', 'ellipse', 'frame'];

export function isCreationTool(tool: Tool): tool is ItemType {
  return (CREATION_TOOLS as string[]).includes(tool);
}
