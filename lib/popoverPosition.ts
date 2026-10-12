/** Viewport-aware fixed popover position (prefers right, then left, then below/above). */
export function computePopoverPosition(
  anchor: DOMRect,
  panelWidth: number,
  panelHeight: number,
  margin = 8,
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const spaceRight = vw - margin - anchor.right;
  const spaceLeft = anchor.left - margin;
  const spaceBelow = vh - margin - anchor.bottom;
  const spaceAbove = anchor.top - margin;

  let left: number;
  let top: number;

  if (panelWidth <= spaceRight) {
    left = anchor.right + margin;
    top = anchor.top;
  } else if (panelWidth <= spaceLeft) {
    left = anchor.left - panelWidth - margin;
    top = anchor.top;
  } else {
    left = anchor.left + anchor.width / 2 - panelWidth / 2;
    left = Math.max(margin, Math.min(left, vw - panelWidth - margin));
    top = anchor.bottom + margin;
  }

  if (top + panelHeight > vh - margin) {
    if (spaceAbove >= panelHeight) {
      top = anchor.top - panelHeight - margin;
    } else if (spaceBelow >= panelHeight) {
      top = anchor.bottom + margin;
    } else {
      top = Math.max(margin, vh - panelHeight - margin);
    }
  }

  if (top < margin) top = margin;

  return { left, top };
}

/** Dropdown / date picker: open below trigger (left-aligned), flip above only if needed. */
export function computeDropdownBelowPosition(
  anchor: DOMRect,
  panelWidth: number,
  panelHeight: number,
  gap = 4,
): { left: number; top: number } {
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.max(panelWidth, anchor.width);
  let left = anchor.left;
  if (left + width > vw - margin) {
    left = Math.max(margin, vw - width - margin);
  }
  let top = anchor.bottom + gap;
  if (top + panelHeight > vh - margin && anchor.top - panelHeight - gap >= margin) {
    top = anchor.top - panelHeight - gap;
  }
  return { left, top };
}
