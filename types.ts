
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface TreeNode {
  id: string;
  parentId: string | null;
  prompt: string;
  styleName: string;
  html: string;
  status: 'streaming' | 'complete' | 'error';
  depth: number;
  position: { x: number; y: number };
  childrenIds: string[];
  indexLabel?: string; // New: Reference label like "V1", "V2"
}

export interface GraphState {
  nodes: Record<string, TreeNode>;
  rootIds: string[];
  selectedNodeIds: string[];
  activeNodeId: string | null;
  nextLabelIndex: number; // New: Counter for V1, V2, etc.
}

export interface ComponentVariation { name: string; html: string; }
