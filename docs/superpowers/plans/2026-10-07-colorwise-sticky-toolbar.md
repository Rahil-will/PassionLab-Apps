# Colorwise Sticky Toolbar Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Colorwise Details left color sidebar with a sticky top toolbar so Size breakdown and Material requirements use full content width.

**Architecture:** Single-file layout change in `CreateOrderColor.tsx`. Reuse existing handlers; restyle color list as horizontal chips inside a sticky bar under the page header.

**Tech Stack:** React 19, Tailwind v4, existing `Button` / `PageShell` / lucide icons.

## Global Constraints

- No new dependencies
- No behavior changes to save / leave / duplicate / delete
- Scope: `CreateOrderColor.tsx` only (plus this plan/spec)
- No git commit unless user asks

---

### Task 1: Sticky toolbar layout

**Files:**
- Modify: `pages/production/CreateOrderColor.tsx` (return JSX ~334–552)
- Spec: `docs/superpowers/specs/2026-10-07-colorwise-sticky-toolbar-design.md`

**Interfaces:**
- Consumes: existing `addColorway`, `handleGoBack`, `handleSave`, `duplicateColorway`, `setDeleteId`, `setActiveColorId`, `draft.colorways`, `activeColorId`
- Produces: sticky toolbar + full-width card column (no new exports)

- [x] **Step 1: Replace sidebar + two-column flex with sticky toolbar + single column**

Remove the `w-56` sticky sidebar and `flex gap-5` two-column shell. Use:

```tsx
<div className="w-full pb-6 space-y-6">
  <div className="sticky top-0 z-20 scroll-sticky-panel bg-white border border-slate-200 rounded-xl shadow-sm px-3 py-2.5 flex items-center gap-3 mb-0">
    {/* Go Back | chips | Add Color + Save */}
  </div>
  <div className="space-y-6 min-w-0">
    {/* Size breakdown + Material cards unchanged */}
  </div>
</div>
```

Toolbar row:

1. Left: Go Back (`variant="secondary"`, `size="sm"`, not full width)
2. Center: `flex-1 min-w-0 overflow-x-auto no-scrollbar` chip row
3. Right: Add Color (`secondary`) then Save Changes (primary), `shrink-0`

Chip item (compact horizontal):

```tsx
<div
  key={cw.id}
  onClick={() => setActiveColorId(cw.id)}
  className={`shrink-0 rounded-lg cursor-pointer relative group flex items-center gap-2 px-2.5 py-1.5 ${
    selected ? 'bg-blue-50 border border-blue-200 text-blue-700' : 'border border-slate-200 hover:bg-slate-50 text-slate-600'
  }`}
>
  <div className="w-3 h-3 rounded-full shrink-0 border border-slate-200" style={swatchStyleFromColorName(cw.name || '')} />
  <div className="min-w-0">
    <div className={`text-[10px] font-semibold whitespace-nowrap ${!cw.name ? 'text-slate-400 italic' : ''}`}>
      {cw.name || 'Untitled'}
    </div>
    <div className="text-[9px] text-slate-400 tabular-nums whitespace-nowrap">
      {sumSizeOrderQty(cw.sizes).toLocaleString()} pcs
    </div>
  </div>
  {/* Duplicate + Delete hover buttons — same handlers as before */}
</div>
```

Empty state: muted “No colors yet.” text in the chip row.

- [ ] **Step 2: Manual verify**

1. Open Colorwise Details — no left color rail; cards full width
2. Scroll materials — toolbar stays at top of content scroll area
3. Add / select / duplicate / delete / save / go back still work

- [ ] **Step 3: Commit only if user requests**
