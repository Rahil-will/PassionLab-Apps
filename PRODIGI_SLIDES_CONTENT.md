# Prodigi Client Presentation — Slide Content

> **PowerPoint file:** [`PRODIGI_Client_Presentation.pptx`](./PRODIGI_Client_Presentation.pptx) (23 slides)  
> **Regenerate:** `python scripts/generate_prodigi_presentation.py`  
> **Source:** `PRODUCT_PRESENTATION_MASTER.md` v1.1

---

## Slide 1 — Title

**Title:** Prodigi  
**Subtitle:** Manufacturing Execution System for Garment Factories  
**Tagline:** Know what is planned · what is happening on the floor · where every piece is

---

## Slide 2 — The Problem

- Factories run on spreadsheets, paper challans, and end-of-day Excel
- No real-time visibility into WIP between departments
- Pieces "appear" in the next department without traceability
- Quality data lives in separate systems from production counts
- Management reports are built manually — always a day late
- Buyer audits fail WIP reconciliation

**Speaker notes:** Open with: "Where are the 2,000 pieces between Cutting and Sewing?"

---

## Slide 3 — What Prodigi Is

- A production-first MES — not ERP, not PLM, not costing
- Tracks every piece through departments: in-house and outsourced
- Real-time floor capture on tablets + unified desktop planning & reports
- Multi-tenant SaaS — one platform, factory-scoped data isolation
- Single job: know what's planned, what's live, and where WIP is

---

## Slide 4 — The MES Engine (Three Rules)

1. **Output XOR QC** — One session per dept+order: hourly/batch OR QC, never both  
2. **Handover is mandatory** — No WIP in dept N+1 without challan from dept N  
3. **Audit is optional** — AQL never blocks flow unless configured  

---

## Slide 5 — Department Classification & Capture Architecture ⭐

**Left panel — hierarchy tree:**

```
Work Center (Department)
├── Origin  →  Cutting (Lay Report)
├── Standard Production
│     ├── Loading  →  Hourly Input
│     └── Produce  →  Hourly | QC | Batch
├── Store  →  Handover only
├── Outsource  →  Vendor capture + 2-leg handover
└── Terminal  →  Shipment / QA

Every non-terminal department also gets:
  • Transaction (handover)  • Audit (optional)  • Supervisory app
```

**Right panel — four layers:**

| Layer | Answers |
|-------|---------|
| 1 | What kind of department? (Origin, Standard Production, Store, Outsource, Terminal) |
| 2 | What operation step? (Loading, Produce, Store, Outsource) |
| 3 | How is data captured? (Hourly, QC, Batch, Cutting Lay, Shipment QA) |
| 4 | Global capabilities (Handover, Audit, Supervisor) |

**Speaker notes:** Origin and Terminal are first-class roles — not flags on Standard.

---

## Slide 6 — Five Department Kinds

- **Origin** (`role=origin`) — first visit; Cutting lay report
- **Standard Production** (`role=standard`, `mode=production`) — Loading + Produce
- **Store** (`role=standard`, `mode=storage`) — passive; handover + supervisor only
- **Outsource** (`role=standard`, `mode=outsource`) — vendor two-leg handover
- **Terminal** (`role=terminal`) — last visit; Shipment / QA

---

## Slide 7 — Three Applications

- **Onboarding App** (RBC) — factories, entitlements, first admin
- **Prodigi Web** — orders, planning, reports, configuration
- **Prodigi Floor** (PWA) — capture apps on tablets
- Configure in Web → execute on Floor → insight in Reports

---

## Slide 8 — Platform Architecture

- Platform → Factories → Departments → Lines → Users → Apps → Data → Reports
- Floor: Factory ID + Employee ID + PIN
- Desktop: email + password (factory admin)

---

## Slide 9 — Who Uses What

- Factory Admin — Web
- Supervisor — Floor: handover, workforce, KPIs
- Operator — Floor: hourly/batch/QC
- QC / Auditor — Floor: inspection / AQL
- Terminal Clerk — Floor: shipment / rejection

---

## Slide 10 — Factory Lifecycle

1. RBC provisions factory + admin  
2. Admin configures work centers, flows, shifts, users  
3. Create orders → routing → line planning  
4. Floor capture → handover → reports → OTIF closure  

---

## Slide 11 — Hourly Production

- Size-wise output by shift hour slot
- Linked to line allocation and daily target
- Balance cap prevents over-entry
- 3 taps to log from home screen

---

## Slide 12 — Handover (WIP Spine)

- Mandatory digital challan between visits
- Send → Receive → Dispute workflow
- Outsourced: two-leg handover
- Next dept blocked until receive confirmed

---

## Slide 13 — Quality

- QC Log: piece-wise defects → DHU same day
- Output XOR QC enforced
- AQL audit optional, non-blocking

---

## Slide 14 — Orders & Planning

- Create order with colorways and shipment plan
- Process flows → frozen order routing
- Gantt line planning with SAM targets

---

## Slide 15 — End-to-End Workflow

Order → Routing → Planning → Cutting → Handover → Sewing → QC → … → Shipment → OTIF

---

## Slide 16 — Reports & Dashboard

- Day Report, Style Report, Transaction Report
- Dashboard: cut-to-ship, OTIF, efficiency trends

---

## Slide 17 — Key KPIs

Output · Efficiency · DHU · Handover compliance · Cut-to-ship · OTIF

---

## Slide 18 — Benefits by Persona

Management · Supervisors · Operators · Quality · Factory-wide traceability

---

## Slide 19 — Security

RLS · PIN hash · No self-service onboarding · Edge Function admin

---

## Slide 20 — Technology

Vite/React Web · Next.js Floor PWA · Supabase Postgres + RPCs

---

## Slide 21 — Roadmap

Multi-factory HQ · Buyer portal · AI insights · Predictive OTIF · IoT

---

## Slide 22 — Why Prodigi Wins

Handover spine · XOR QC · Four-layer model · Production-first · RBC implementation

---

## Slide 23 — Next Steps

- Pilot factory — 4-week implementation  
- Live demo walkthrough  
- Contact RBC  

---

## Customisation notes

| Deck variant | Slides to add/remove |
|--------------|---------------------|
| Executive (10 min) | Keep 1–6, 16–17, 22–23 |
| Sales (30 min) | Full deck minus 19–20 |
| Demo + live | Insert screenshots at slides 11–16 after generating from app |

To add screenshots: open `PRODIGI_Client_Presentation.pptx` in PowerPoint → Insert → Pictures on slides 11–16.
