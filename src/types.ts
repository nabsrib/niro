export type Vec = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

/**
 * Camera maps world coordinates to screen coordinates:
 *   screen = world * z + (x, y)
 */
export type Camera = { x: number; y: number; z: number };

export type ItemType = 'sticky' | 'rect' | 'ellipse' | 'text' | 'frame' | 'path' | 'image' | 'emoji' | 'link' | 'comment';

/** One message in a comment thread. */
export interface CommentMessage {
  id: string;
  /** Who wrote it: their identity (account id or this browser's id) and name at the time. */
  author: string;
  authorName: string;
  text: string;
  /** When it was written (ms since 1970). */
  at: number;
}

/** Shapes a rectangle item can take (shapes.ts). */
export type ShapeKind =
  | 'rect'
  | 'round'
  | 'triangle'
  | 'diamond'
  | 'parallelogram'
  | 'hexagon'
  | 'star'
  | 'arrow'
  | 'cylinder'
  | 'bubble';

/** Style a part of an item's text can override (absent = the item's own style). */
export interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Font size in world units. */
  size?: number;
  color?: string;
}

/** A piece of rich text: its text plus the style overrides it has. */
export interface TextRun extends RunStyle {
  text: string;
}

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
  /** Text items, stickies and shapes: text style (absent = the defaults in textStyle.ts). */
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Stickies and shapes only: vertical position of the text. */
  valign?: 'top' | 'middle' | 'bottom';
  /** Stickies and shapes only: text color (absent = black or white, whichever reads on the fill). */
  textColor?: string;
  /**
   * Rich text: the text split into styled pieces, when part of it has its own
   * style (size, bold, color...). `text` always holds the same text, plain.
   */
  rich?: TextRun[];
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
  /**
   * Locked: can be selected, copied and connected to, but not moved, resized,
   * edited or deleted. A locked frame stays put; what is inside it stays editable.
   */
  locked?: boolean;
  /** Frames only: cut off the parts of items that stick out of the frame. */
  clip?: boolean;
  /**
   * Frames only: hidden from everyone except the person who hid it (`hiddenBy`,
   * their identity: account id or this browser's id), who sees it dimmed.
   */
  hiddenBy?: string;
  /** Link cards only: the web address. */
  url?: string;
  /** Comment pins only: the messages, oldest first. */
  thread?: CommentMessage[];
  /** Comment pins only: marked resolved (shown faded). */
  resolved?: boolean;
  /** Rectangles only: the shape drawn (shapes.ts); absent = plain rectangle. */
  shape?: ShapeKind;
  /** Rectangles and ellipses: border color; absent = BORDER_DEFAULTS.color. */
  border?: string;
  /** Rectangles and ellipses: border width (0 = no border); absent = BORDER_DEFAULTS.width. */
  borderWidth?: number;
  /** Rectangles and ellipses: dashed or dotted border; absent = solid. */
  borderDash?: LineDash;
  /**
   * Images only: id of the picture file (assets.ts). The file itself is kept in
   * the browser and, for boards on the server, uploaded there; never in the board.
   */
  src?: string;
}

/** What someone may do on a board kept with an account. */
export type Role = 'owner' | 'editor' | 'viewer';
/** Who else may open a board with its link: nobody, viewers, or editors (signed in). */
export type LinkAccess = 'none' | 'view' | 'edit';

/**
 * A board in the boards list (its content is stored separately, under its id).
 * Boards kept with an account (on the server) have `role` and `account`; boards
 * without them are only in this browser.
 */
export interface BoardMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Your role on it (server boards only). */
  role?: Role;
  /** Id of the account this board came with (server boards only). */
  account?: string;
  linkAccess?: LinkAccess;
  /** Guests (no account) may use the link too. */
  guestAccess?: boolean;
  ownerName?: string;
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
/** End of a connector: nothing, a filled arrow, an open arrow, a dot, a diamond or a bar. */
export type ArrowHead = 'none' | 'arrow' | 'open' | 'circle' | 'diamond' | 'bar';
export const ARROW_HEADS: ArrowHead[] = ['none', 'arrow', 'open', 'circle', 'diamond', 'bar'];
/** Line pattern (absent = solid). */
export type LineDash = 'dashed' | 'dotted';
/**
 * Hand-placed middle segment of an elbow connector: a vertical run (`axis: 'x'`)
 * or a horizontal run (`axis: 'y'`), `offset` world units from the point halfway
 * between the ends, so it keeps its place relative to them when items move.
 */
export type ElbowChannel = { axis: 'x' | 'y'; offset: number };

export interface Connector {
  id: string;
  from: Endpoint;
  to: Endpoint;
  style: ConnectorStyle;
  stroke: string;
  strokeWidth: number;
  startArrow: ArrowHead;
  endArrow: ArrowHead;
  /**
   * Bend points the line passes through, in order (straight: sharp corners,
   * curved: a smooth curve through them); absent or empty = none. Elbow lines
   * use `channel` instead.
   */
  bends?: Bend[] | null;
  /** Older saves: a single curve bend (read as `bends: [bend]`, see `bendsOf`). */
  bend?: Bend | null;
  /** Elbow lines: hand-placed middle segment; absent = automatic route. */
  channel?: ElbowChannel | null;
  /** Dashed or dotted line; absent = solid. */
  dash?: LineDash | null;
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
export type Tool = 'select' | 'hand' | 'connector' | 'pen' | 'comment' | CreationTool;

export type CreationTool = Exclude<ItemType, 'path' | 'image' | 'emoji' | 'link' | 'comment'>;

export const CREATION_TOOLS: CreationTool[] = ['sticky', 'text', 'rect', 'ellipse', 'frame'];

export function isCreationTool(tool: Tool): tool is CreationTool {
  return (CREATION_TOOLS as string[]).includes(tool);
}
