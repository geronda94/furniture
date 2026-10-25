# Strategy Expansion — Forks, Adjacent Markets & Industrial 3D Services

> Created: 2026-10-25. Based on deep research (Oct 2026 data).
> Goal: Evaluate forks of the Furniture engine into higher-value adjacent markets and build a realistic multi-track revenue strategy.

---

## Executive Summary

**Current position:** Working furniture configurator prototype (TRL 5-6), deterministic engine, 3D Babylon viewer, CSV/SVG/DXF export, pilot-ready for Romanian small workshops.

**Market reality:**
- Pure furniture SaaS is crowded (Roomle €850-1450/mo, Closetforge £79-199/mo, Planner5D enterprise, Polymuse, Configurix) and sales cycles are 4-8 months.
- **Property developer configurators** command €2-15K/project + recurring, shorter sales (buyers need to sell off-plan *now*).
- **BIM/AEC services** for residential developers are growing 15%+ CAGR; CAD→BIM conversion is a $15-40/sheet commodity but LOD 400 is $15-20K/project.
- **3D modeling as a service** market: $4.78B (2025) → $13.36B (2033), CAGR 13.7%. Architectural viz: $350-8000/image; India outsourcing $350-700/still.
- **Industrial CPQ** (equipment, machinery) pays €5-50K setup + €500-2000/mo for configurators that emit BOM/routing.

**Strategic pivot:** Don't compete on "furniture configurator SaaS." Use the deterministic engine as a **platform kernel** and sell **vertical solutions** where the engine's production output (cut lists, BOM, DXF, 3D) is the differentiator.

---

## Track 1: Fast Money (0-3 months) — Service Layer on Current Engine

| Offer | Target | Price | Delivery | Why it works |
|-------|--------|-------|----------|--------------|
| **Pilot: "Kitchen/wardrobe project in 2h"** | 20 RO workshops | €300 | Web engine → CSV/SVG/PDF + 3 Blender screens | Engine already does this; workshops lose €500-2000/error |
| **Widget: "Configure your wardrobe on our site"** | 3-5 workshops with traffic | €100/mo + €20/lead | iframe embed, their catalog (5 presets) | No code change; proves white-label demand |
| **Content-as-a-Service: 3D renders + video** | Furniture brands, Mobexpert-type | €500-800/video | Blender pipeline (engine → scene3d.json → render) | Brands pay for marketing assets, not software |
| **CAD→Cutting service** | Workshops with CNC but no nesting | €50/sheet | MaxRects engine → SVG/DXF | Immediate ROI: 1 sheet saved = €100+ |

**Target: €1.5K/mo by day 60.** See `FAST_MONEY_PLAN.md` for daily execution.

---

## Track 2: Property Developer Fork (3-9 months) — "Apartment Configurator"

### Market Map (2026 pricing)

| Player | Model | Price | Note |
|--------|-------|-------|------|
| **youconfig.com** | SaaS, per project | Contact (est. €2-5K/project) | 2D→3D, real-time pricing, tile system |
| **MaverickFrame** | Project-based | €5-20K | Interactive selector + masterplan + finishes |
| **Beyond Visual** | Project + retainer | €10-50K | Real-time walkthrough + configurator |
| **Aperex (EstateTech)** | Platform license | €15-50K/yr | Full sales platform: filter, tour, configurator |
| **Divergent (Altura)** | Domain-locked | €20-40K setup | 360° orbit, apartment finder, finish configurator |
| **Vinode** | Per project | €3-10K | Browser-based, 2s load, availability sync |
| **Habiteo** | Package | €5-15K | Model apartment + 100 materials, tablet-ready |
| **R2U** | Full platform | €20-100K | Finish configurator, sunlight sim, view-from-window |
| **Habiteo** | Essential package | Contact | 1 model apartment, 100 materials |

### Our Angle: **Production-Grade Output**

Competitors output *visuals only*. Our engine outputs:
- **Valid finish packages** constrained by developer's actual catalog (tiles, parquet, sanitary, kitchen modules)
- **Real-time pricing** per finish combo (developer's price tiers)
- **BOM for procurement** (quantities of tiles, laminate, paint, kitchen modules per apartment type)
- **Cut lists for kitchen/wardrobe** (if developer supplies fitted furniture)
- **DXF/SVG for CNC** (workshop-ready)
- **IFC export** for BIM coordination

### MVP Scope (3 months)

| Component | Effort | Reuse from Furniture |
|-----------|--------|---------------------|
| **Catalog schema**: finishes (tile/laminate/paint/sanitary/kitchen) + pricing tiers | 2 weeks | Parameter system |
| **Apartment type library**: 20-50 types, room-by-room finish slots | 3 weeks | Module presets |
| **Finish configurator UI**: room-by-room, real-time price, 3D Babylon swap materials | 4 weeks | 3D viewer, parameter binding |
| **Developer admin**: catalog upload (CSV), price tiers, availability | 3 weeks | Project storage |
| **Outputs**: PDF finish schedule per apartment, BOM (Excel), IFC export | 3 weeks | CSV/JSON/DXF export |
| **Embed**: iframe + lead capture → developer CRM | 2 weeks | API endpoints |

**Total: ~17 weeks (1 dev + 1 designer).** Can be parallelized.

### Go-to-Market

1. **Pilot with 1 Romanian developer** (YIT-type but local): free 3-month pilot, 5 apartment types, their catalog. Goal: 50 configured apartments, 10 leads.
2. **Case study → 3 more developers** at €5K setup + €500/mo + €50/lead.
3. **Scale to Bulgaria/Hungary** via local reseller (20-30% rev share).

### Revenue Projection

| Month | Developers | Setup | MRR | Leads/mo | Lead Rev | Total/mo |
|-------|------------|-------|-----|----------|----------|----------|
| 3 | 1 (pilot) | €0 | €0 | 20 | €0 | €0 |
| 6 | 3 | €15K | €1.5K | 60 | €3K | €4.5K |
| 9 | 6 | €30K | €3K | 120 | €6K | €9K |
| 12 | 10 | €50K | €5K | 200 | €10K | €15K |

---

## Track 3: Architect / BIM Service Bureau (3-6 months) — "CAD→BIM→Configurator"

### Market Data

- **CAD→BIM conversion:** $15-40/sheet (simple), $15-20K (LOD 400 commercial). India: $18/hr.
- **BIM drafting services:** Growing 15.6% CAGR. Outsourcing = access to scarce talent.
- **Residential BIM coordination:** ENGDOC, United-BIM, VirtualBuildingStudio — they coordinate typical floors, stacked risers, service clashes.
- **Architechtures:** $588/yr for generative design (early phase). GBuilder: contact pricing (YIT uses it).

### Our Play: **"Configurable BIM Library"**

Instead of pure conversion service, deliver **parametric Revit families + web configurator** for repeated apartment types.

| Service | Price | Delivery |
|---------|-------|----------|
| **Typical floor BIM package** (5 apartment types, LOD 300, parametric families) | €8-15K | Revit families + web configurator for finish selection |
| **Stacked riser coordination** (clash-free MEP) | €5-10K | Revit model + coordination report |
| **Developer handover package**: configurator + BOM + IFC | €3-5K/project | Web app + Revit + IFC |

### Why We Win

- Most BIM bureaus deliver *static models*. We deliver **parametric models + web configurator** so developer's sales team can configure finishes without BIM skills.
- Our engine already generates **valid combinations only** (rules engine) — prevents impossible finish combos reaching construction.
- **Single source of truth:** web configurator ↔ Revit family parameters ↔ BOM.

### Pilot Path

1. Partner with 1 BIM bureau (they do Revit, we do configurator + rules). Split €10K project 50/50.
2. 1 developer client → 1 typical floor → 5 apartment types.
3. Document: "From CAD to configured apartment in 2 weeks."

---

## Track 4: Industrial 3D Modeling as a Service (6-12 months) — "Digitization Factory"

### Market Data

| Segment | Market Size | Growth | Typical Price |
|---------|-------------|--------|---------------|
| **3D Modeling Services** | $4.78B (2025) → $13.36B (2033) | 13.7% CAGR | $350-8000/image (arch), $350-700 (India) |
| **CAD→BIM Conversion** | Part of $7B BIM services | 15.6% CAGR (services) | $15-40/sheet, $15-20K LOD 400 |
| **Industrial CPQ/Configurator** | Niche of $14B furniture mfg SW | 5.3% CAGR | €5-50K setup + €500-2000/mo |
| **Architectural Viz Outsourcing** | Large, fragmented | Steady | $350-8000/image, $320-630/floor plan |

### Our Angle: **Deterministic Digitization Pipeline**

Most 3D services are **manual** (artists model in Blender/3ds Max). Our engine enables **automated, rule-based model generation** from parametric specs.

| Service | Input | Output | Price | Target |
|---------|-------|--------|-------|--------|
| **Catalog Digitization** | PDF catalog + dimensions | Parametric 3D models (GLB/USDZ) + web configurator | €2-5K/50 SKUs | Furniture brands, kitchen manufacturers |
| **CAD→Configurator** | DWG/DXF of product line | Web configurator + BOM/DXF export | €5-15K | Industrial equipment, modular builders |
| **BIM Family Library** | Revit families + rules | Parametric families + web finish selector | €10-30K | Developers, architects |
| **Production-Ready Models** | Parametric spec | GLB + cut lists + DXF + BOM | €500-2000/model | CNC workshops, flat-pack manufacturers |

### Operational Model: **"Digitization Factory"**

1. **Standardize intake:** Client uploads PDF/DWG + spec sheet → our parser extracts dimensions, materials, options.
2. **Rule engine maps to engine schema** (Params → Section → Parts).
3. **Engine generates:** 3D (GLB/USDZ), 2D (SVG/DXF), BOM (CSV), cut list (SVG), pricing (JSON).
4. **QA:** Automated validation (geometry tests) + human spot-check.
5. **Delivery:** Web viewer (iframe), download package, API access.

### Pricing & Unit Economics

| Service | Price | Cost (engine + 1h human QA) | Margin | Monthly Capacity (1 operator) |
|---------|-------|----------------------------|--------|-------------------------------|
| Catalog Digitization (50 SKU) | €3,000 | €300 | 90% | 10 projects |
| CAD→Configurator | €10,000 | €1,000 | 90% | 3 projects |
| BIM Family Library | €20,000 | €2,000 | 90% | 2 projects |
| Single Production Model | €1,000 | €100 | 90% | 50 models |

**At 50% utilization:** €45K/mo revenue, €4.5K cost → **€40.5K gross margin.**

### Hiring Plan

| Role | When | Cost/mo | Output |
|------|------|---------|--------|
| **Digitization Operator** (junior architect/engineer) | Month 6 | €800-1200 | 10 catalog projects or 50 models |
| **Technical QA** (senior) | Month 9 | €1500-2000 | Rule validation, complex projects |
| **Sales/Outreach** | Month 3 | €1000 + 10% | Pipeline for Tracks 2-4 |

---

## Track 5: White-Label Widget Platform (9-18 months) — "Configurator-as-a-Service"

### Market Gap

Current white-label players:
- **Roomle/Planner5D/Polymuse:** €850-1450/mo, enterprise sales, 3-6 month onboarding.
- **Closetforge:** £79-199/mo, but wardrobe-only, limited rules.
- **3dconfigurator.dev:** $8-28K one-time, custom dev, no recurring.

**Gap:** **€100-300/mo, self-serve, production-output, 1-week onboarding** for manufacturers with 20-200 SKUs.

### Our MVP: **"Configurator in a Box"**

| Feature | Furniture Engine Base | Added for Platform |
|---------|----------------------|-------------------|
| Multi-tenant (subdomain, branding) | ❌ | ✅ (2 weeks) |
| Catalog import (CSV → Params) | Manual | ✅ Auto-mapper (3 weeks) |
| Rules builder (no-code) | Code | ✅ Visual rule builder (6 weeks) |
| BOM/DXF/SVG export | ✅ | ✅ Branded download |
| Embed (iframe + lead webhook) | API | ✅ One-line embed |
| Analytics (configs, leads, popular options) | ❌ | ✅ Dashboard (2 weeks) |
| Billing (Stripe, per-tenant) | ❌ | ✅ Stripe Connect (2 weeks) |

**Total platform build: ~15 weeks (1 full-stack dev).**

### Pricing

| Tier | Setup | Monthly | Per Lead | Best For |
|------|-------|---------|----------|----------|
| **Starter** | €500 | €99 | €15 | 20-50 SKU, 1 brand |
| **Pro** | €1,500 | €299 | €10 | 100-500 SKU, dealer network |
| **Enterprise** | €5,000 | €799 | €5 | 500+ SKU, multi-country, API |

### Unit Economics

- **CAC:** €500 (content + cold outreach to manufacturers)
- **LTV (Pro, 24mo churn):** 299 × 24 × 0.8 = €5,740
- **LTV/CAC:** 11.5x
- **Payback:** 2 months

### Rollout

1. **Month 9-12:** Build platform (parallel to Tracks 2-3 revenue).
2. **Month 12:** 5 beta manufacturers (from Track 1 contacts) → free 3 months.
3. **Month 15:** Launch Starter/Pro. Target 20 paying by month 18.
4. **Month 24:** 100 paying → €25K MRR.

---

## Consolidated Revenue Projection (18 Months)

| Month | Track 1 (Services) | Track 2 (Developers) | Track 3 (BIM) | Track 4 (Digitization) | Track 5 (Platform) | Total |
|-------|-------------------|---------------------|---------------|------------------------|-------------------|-------|
| 3 | €2K | €0 | €0 | €0 | €0 | €2K |
| 6 | €4K | €4.5K | €5K | €0 | €0 | €13.5K |
| 9 | €5K | €9K | €10K | €15K | €0 | €39K |
| 12 | €5K | €15K | €15K | €30K | €2K | €67K |
| 15 | €5K | €20K | €20K | €40K | €8K | €93K |
| 18 | €5K | €25K | €25K | €45K | €25K | €125K |

**Assumptions:** Track 1 plateaus at €5K (time-bound), Tracks 2-4 scale with 1 operator each, Track 5 kicks in at month 12.

---

## Technical Architecture: Shared Kernel

```
furniture_core/           # Deterministic engine (params → parts → cutting → BOM → scene3d)
├── kernel/
│   ├── params.py         # Schema, validation, defaults
│   ├── geometry.py       # Parts, cutting, DXF, SVG, GLB
│   ├── rules.py          # Constraints, valid combinations, pricing
│   └── export.py         # CSV, JSON, DXF, SVG, GLB, IFC (new)
├── verticals/
│   ├── furniture/        # Current: Section, kitchen, wardrobe
│   ├── apartment/        # Track 2: ApartmentType, FinishSlot, PriceTier
│   ├── bim/              # Track 3: RevitFamily, ParameterMap, ClashRule
│   ├── industrial/       # Track 4: EquipmentSpec, Routing, MultiLevelBOM
│   └── platform/         # Track 5: Tenant, CatalogImport, RuleBuilder
└── apps/
    ├── api/              # FastAPI: /solve, /validate, /catalog, /projects
    ├── web/              # Vue 3 + Babylon: configurator, viewer, admin
    └── blender/          # blender_build.py: scene3d.json → .blend → renders
```

**Key principle:** Verticals share **params → geometry → export** kernel. Only schema and rules differ.

---

## Risk Assessment & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Track 1 stalls** (no pilots) | Medium | High | Pre-sell 3 pilots before building; fallback to pure content services |
| **Developer fork too complex** | Medium | High | Start with finishes only (no structural); partner with BIM bureau |
| **Digitization factory quality issues** | Medium | Medium | Automated geometry tests + human QA; start with simple catalogs |
| **Platform build delays** | High | Medium | Defer to month 12; use revenue from Tracks 1-4 to fund |
| **Competitor copies production-output angle** | Medium | Medium | Moat = deterministic engine + test suite + vertical rules (not just 3D) |
| **Romania market too small** | Low | Medium | Tracks 2-4 are EU-agnostic; language/catalog localization is config |
| **Founder bandwidth** | High | High | Hire operator at €1K/mo by month 6; Track 1 → contractor |

---

## Decision Gates

| Gate | When | Criteria | Go/No-Go |
|------|------|----------|----------|
| **G1: Service Validation** | Day 30 | ≥2 paid pilots (€600+) | Go → Track 1 continues |
| **G2: Developer Pilot** | Month 4 | 1 developer signed, 5 apt types configured | Go → Track 2 builds MVP |
| **G3: BIM Partnership** | Month 5 | 1 BIM bureau LOI, 1 joint project | Go → Track 3 builds |
| **G4: Digitization Factory** | Month 6 | 3 catalog projects delivered, 90% margin | Go → Hire operator |
| **G5: Platform Build** | Month 12 | €50K ARR from Tracks 1-4, 5 beta manufacturers | Go → Build platform |

---

## Immediate Next Steps (This Week)

1. **Finalize FAST_MONEY_PLAN execution** — start 20 calls Monday.
2. **Identify 3 Romanian developers** for Track 2 pilot outreach (LinkedIn: "YIT Romania", "Skanska Romania", "One United Properties", local mid-size).
3. **Contact 2 BIM bureaus** in Bucharest/Cluj for Track 3 partnership conversation.
4. **List 20 furniture brands** (Mobexpert, XXXLutz, local manufacturers) for Track 1 content outreach.
5. **Set up tracking sheet** (Google Sheets) with tabs: Outreach, Pilots, Inbound, Money, Tracks.

---

## Appendix: Key Research Sources (Oct 2026)

| Domain | Sources |
|--------|---------|
| Furniture Configurators | Roomle pricing (€850-1450/mo), Closetforge (£79-199), 3dconfigurator.dev ($8-28K), Planner5D, Polymuse, Configurix |
| Property Developer Config | youconfig, MaverickFrame, Beyond Visual, Aperex, Divergent, Vinode, Habiteo, R2U, Avedge, Redotree |
| Romania Furniture | WorldMetrics (€1.2B retail, €3.2B prod, 12-18% online), Furnilytics (€2.1B consumer, €3.2B mfg), RO Times (consumption challenges 2026) |
| BIM/AEC Residential | Architechtures ($588/yr), GBuilder (YIT case), ENGDOC, United-BIM, Architechtures generative design |
| 3D Modeling Services | Cognitive Market Research ($4.78B→$13.36B, 13.7% CAGR), Fenestra ($350-8000/img), India outsourcing ($350-700) |
| Furniture Mfg Software | Insight Partners ($14.19B→$21.5B, 5.33% CAGR), RenaissanceTech CPQ, Aktiv ERP, Cincom CPQ comparison |
| CPQ Industrial | Roomle, Tacton, Infor (Gartner Leader), Configure One, Cincom, VividWorks, Expivi, VisionThree |
| CAD→BIM | BuiltInBIM ($15-40/sheet, $15-20K LOD400), IndiaCADWorks ($18/hr), Arrival3D, United-BIM, VirtualBuildingStudio |
| Arch Viz Pricing | 3dpraxisstudio (2026 breakdown), ArchVizStudio, CG Viz, Behance ($230-350), India outsourcing guide |