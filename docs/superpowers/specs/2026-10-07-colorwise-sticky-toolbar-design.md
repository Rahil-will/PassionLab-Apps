# Colorwise Details — Sticky Color Toolbar

**Date:** 2026-10-07  
**Status:** Approved  
**Page:** `pages/production/CreateOrderColor.tsx`

## Problem

Colorwise Details uses a left `w-56` sidebar for Go Back / Save / Add Color and the color list. That steals horizontal space from Size breakdown and Material requirements tables.

## Decision

Replace the left sidebar with a **sticky horizontal toolbar** under the page header (Approach 2). Cards become full content width.

## Layout

```
[ Page header: Colorwise Details ]
[ Sticky toolbar: Go Back | color chips (scroll) | Add Color + Save ]
[ Size breakdown — full width ]
[ Material requirements — full width ]
```

### Toolbar

- Left: Go Back
- Center: horizontally scrollable color chips (swatch + name + pcs)
- Right: Add Color, then Save Changes (primary)
- `sticky top-0 z-20` inside the main `overflow-auto` scroll container
- Solid white background so scrolled cards do not show through
- Selected chip: blue highlight (same semantics as current sidebar item)
- Duplicate / Delete: reveal on chip hover (same as today)

### Behavior (unchanged)

- Select color → show that color’s size + materials
- Add / Save / Back / Duplicate / Delete / unsaved leave modals — existing handlers only

## Out of scope

- Create Order master list (`ColorwayWorkspaceSection` / `ColorQtyWorkspace`)
- Sticky page header / breadcrumb changes
- New dependencies

## Success criteria

1. No left color sidebar on Colorwise Details
2. Toolbar stays visible while scrolling materials
3. Size and Material cards use full width to the right of the main nav
4. All existing color CRUD / save / leave behavior still works
