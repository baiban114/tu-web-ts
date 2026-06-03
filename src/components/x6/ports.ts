export const PORT_GROUPS = {
  top: {
    position: 'top',
    attrs: {
      circle: {
        r: 4,
        magnet: true,
        stroke: '#1677ff',
        strokeWidth: 2,
        fill: '#ffffff',
        visibility: 'hidden',
      },
    },
  },
  right: {
    position: 'right',
    attrs: {
      circle: {
        r: 4,
        magnet: true,
        stroke: '#1677ff',
        strokeWidth: 2,
        fill: '#ffffff',
        visibility: 'hidden',
      },
    },
  },
  bottom: {
    position: 'bottom',
    attrs: {
      circle: {
        r: 4,
        magnet: true,
        stroke: '#1677ff',
        strokeWidth: 2,
        fill: '#ffffff',
        visibility: 'hidden',
      },
    },
  },
  left: {
    position: 'left',
    attrs: {
      circle: {
        r: 4,
        magnet: true,
        stroke: '#1677ff',
        strokeWidth: 2,
        fill: '#ffffff',
        visibility: 'hidden',
      },
    },
  },
} as const;

export const MINDMAP_PORT_GROUPS = {
  right: PORT_GROUPS.right,
  left: PORT_GROUPS.left,
} as const;

export function createNodePorts() {
  return {
    groups: PORT_GROUPS,
    items: [
      { id: 'port-top', group: 'top' },
      { id: 'port-right', group: 'right' },
      { id: 'port-bottom', group: 'bottom' },
      { id: 'port-left', group: 'left' },
    ],
  };
}

/** 思维导图 LR 布局：子节点从右侧连出、从左侧接入 */
export function createMindmapPorts() {
  return {
    groups: MINDMAP_PORT_GROUPS,
    items: [
      { id: 'port-right', group: 'right' },
      { id: 'port-left', group: 'left' },
    ],
  };
}
