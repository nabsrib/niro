export type Vec = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

/**
 * Camera maps world coordinates to screen coordinates:
 *   screen = world * z + (x, y)
 */
export type Camera = { x: number; y: number; z: number };

export type ItemType = 'sticky' | 'rect' | 'ellipse' | 'text';

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

export type Tool = 'select' | 'hand' | ItemType;

export const CREATION_TOOLS: ItemType[] = ['sticky', 'text', 'rect', 'ellipse'];

export function isCreationTool(tool: Tool): tool is ItemType {
  return (CREATION_TOOLS as string[]).includes(tool);
}
