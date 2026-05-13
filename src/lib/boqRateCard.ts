// Hagerstone rate card — extracted from historical BOQs.
// ⚠ QS team must validate every rate before going live.
// Rates are in ₹ per the listed unit (sqft, rft, or nos).
//
// This module is the single source of truth on the PMS side. The n8n
// workflow keeps its own copy embedded in a Code node so the workflow
// is self-contained on Railway. Keep both in sync until the rate card
// moves into a `design_rate_card` Supabase table (see follow-ups in
// boq-integration.md §8).

export type RateUnit = 'sqft' | 'rft' | 'nos'

export interface RateEntry {
  rate: number
  unit: RateUnit
  desc: string
}

export const HAGERSTONE_RATES = {
  civil: {
    floor_dismantling:   { rate: 60.50,  unit: 'sqft', desc: 'Floor dismantling and disposal' },
    pcc_work:            { rate: 93.50,  unit: 'sqft', desc: '75mm PCC M-10 grade with wire mesh' },
    waterproofing:       { rate: 110.00, unit: 'sqft', desc: 'Dr. Fixit waterproofing (wet areas only)' },
    rough_plaster:       { rate: 55.00,  unit: 'sqft', desc: 'Rough plaster on walls (wet areas)' },
    pop_punning:         { rate: 42.00,  unit: 'sqft', desc: 'POP punning on walls' },
    deck_slab:           { rate: 715.00, unit: 'sqft', desc: 'RCC deck slab 100mm (terrace)' },
  },
  flooring: {
    rubber_gym:          { rate: 715.00, unit: 'sqft', desc: 'Heavy-duty rubber gym tiles 10mm, Eco-Trax or equivalent' },
    lvt:                 { rate: 495.00, unit: 'sqft', desc: 'Luxury vinyl tile (LVT), 2mm, Armstrong or equivalent' },
    wooden_flooring:     { rate: 660.00, unit: 'sqft', desc: 'Pre-finished wooden flooring 12mm, AC4 grade' },
    marble:              { rate: 495.00, unit: 'sqft', desc: 'Italian marble 18mm, P3 finish' },
    vitrified_800:       { rate: 198.00, unit: 'sqft', desc: 'Vitrified tiles 800×800mm, RAK or equivalent, P3 finish' },
    antiskid_vitrified:  { rate: 130.00, unit: 'sqft', desc: 'Anti-skid vitrified tiles 600×600mm (toilets/terrace)' },
    kota_stone:          { rate: 99.00,  unit: 'sqft', desc: 'Kota stone 20mm (utility/service areas)' },
  },
  ceiling: {
    gypsum_plain:        { rate: 215.00, unit: 'sqft', desc: 'Gypsum false ceiling 12.5mm, Saint-Gobain, single layer' },
    gypsum_with_coves:   { rate: 259.00, unit: 'sqft', desc: 'Gypsum false ceiling with cove profile' },
    wpc_fluted:          { rate: 440.00, unit: 'sqft', desc: 'WPC / laminated fluted ceiling panels' },
    metal_grid:          { rate: 195.00, unit: 'sqft', desc: 'Metal grid ceiling 600×600mm tiles (toilets/service)' },
    metal_false_ceiling: { rate: 418.00, unit: 'sqft', desc: 'Metal false ceiling (terraces, outdoor areas)' },
    ceiling_paint_aep:   { rate: 44.00,  unit: 'sqft', desc: 'Asian Paints Tractor Emulsion AEP on ceiling' },
  },
  wall: {
    aep_paint:           { rate: 44.00,  unit: 'sqft', desc: 'Asian Paints Tractor Emulsion AEP 2 coats' },
    premium_emulsion:    { rate: 66.00,  unit: 'sqft', desc: 'Asian Paints Royale Matt 2 coats' },
    wallpaper:           { rate: 220.00, unit: 'sqft', desc: 'Wallpaper supply & installation (feature wall)' },
    fluted_panel_wpc:    { rate: 352.00, unit: 'sqft', desc: 'WPC fluted wall panel, 9mm, with back frame' },
    mirror_cladding:     { rate: 550.00, unit: 'sqft', desc: 'Mirror cladding 6mm toughened (gym/dance walls)' },
    acoustic_panel:      { rate: 418.00, unit: 'sqft', desc: 'Acoustic foam/fabric panel (studios/conference)' },
    tile_dado:           { rate: 220.00, unit: 'sqft', desc: 'Ceramic tile dado up to 7ft height (wet areas)' },
    exterior_paint:      { rate: 60.50,  unit: 'sqft', desc: 'Apex exterior emulsion (terrace boundary walls)' },
  },
  skirting: {
    aluminium_50mm:      { rate: 175.00, unit: 'rft',  desc: 'Aluminium skirting 50mm with SS screws' },
    tile_skirting:       { rate: 99.00,  unit: 'rft',  desc: 'Tile skirting to match floor' },
  },
  doors: {
    flush_900_2100:      { rate: 28000,  unit: 'nos',  desc: 'Flush door 900×2100mm, 35mm thick, laminate finish' },
    flush_800_2100:      { rate: 25000,  unit: 'nos',  desc: 'Flush door 800×2100mm, 35mm thick, laminate finish' },
    glass_door_frameless:{ rate: 45000,  unit: 'nos',  desc: 'Frameless glass door 900×2100mm, 12mm toughened' },
    toilet_door:         { rate: 18000,  unit: 'nos',  desc: 'Toilet door 750×2100mm, WPC frame + laminate shutter' },
  },
  mep: {
    electrical:          { rate: 350.00, unit: 'sqft', desc: 'Electrical wiring, DB, switches, light points, power points' },
    hvac_vrv:            { rate: 550.00, unit: 'sqft', desc: 'HVAC — VRV/VRF system, ductwork, grilles' },
    lv_firefighting:     { rate: 180.00, unit: 'sqft', desc: 'LV cabling, fire detection, sprinklers, hose reels' },
    pa_system:           { rate: 90.00,  unit: 'sqft', desc: 'PA/background music system, speakers' },
    plumbing_basic:      { rate: 165.00, unit: 'sqft', desc: 'Plumbing — inlet/outlet, fixtures (wet areas only)' },
  },
} as const satisfies Record<string, Record<string, RateEntry>>

export type RateCategory = keyof typeof HAGERSTONE_RATES

// Space-type templates: each tuple is [category, item_key, qty_basis, multiplier].
// qty_basis: 'floor' = area sqft, 'wall' = wall sqft, 'perimeter' = perimeter rft, 'nos' = count
// multiplier: fraction of the basis the item covers (1.0 = full, 0.3 = feature wall only, etc.)

export type QtyBasis = 'floor' | 'wall' | 'perimeter' | 'nos'
export type TemplateRow = [RateCategory, string, QtyBasis, number]

export const BOQ_TEMPLATES: Record<string, TemplateRow[]> = {
  gym: [
    ['civil',    'floor_dismantling',   'floor',     1.0],
    ['civil',    'pcc_work',            'floor',     1.0],
    ['flooring', 'rubber_gym',          'floor',     0.75],
    ['flooring', 'lvt',                 'floor',     0.25],
    ['ceiling',  'wpc_fluted',          'floor',     1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',     1.0],
    ['wall',     'aep_paint',           'wall',      0.50],
    ['wall',     'mirror_cladding',     'wall',      0.35],
    ['wall',     'acoustic_panel',      'wall',      0.15],
    ['skirting', 'aluminium_50mm',      'perimeter', 1.0],
    ['mep',      'electrical',          'floor',     1.0],
    ['mep',      'hvac_vrv',            'floor',     1.0],
    ['mep',      'lv_firefighting',     'floor',     1.0],
    ['mep',      'pa_system',           'floor',     1.0],
  ],
  yoga: [
    ['civil',    'floor_dismantling',   'floor',     1.0],
    ['civil',    'pcc_work',            'floor',     1.0],
    ['flooring', 'lvt',                 'floor',     1.0],
    ['ceiling',  'gypsum_plain',        'floor',     1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',     1.0],
    ['wall',     'aep_paint',           'wall',      0.60],
    ['wall',     'mirror_cladding',     'wall',      0.30],
    ['wall',     'acoustic_panel',      'wall',      0.10],
    ['mep',      'electrical',          'floor',     1.0],
    ['mep',      'hvac_vrv',            'floor',     1.0],
    ['mep',      'pa_system',           'floor',     1.0],
  ],
  zumba: [
    ['civil',    'floor_dismantling',   'floor',     1.0],
    ['civil',    'pcc_work',            'floor',     1.0],
    ['flooring', 'wooden_flooring',     'floor',     1.0],
    ['ceiling',  'gypsum_with_coves',   'floor',     1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',     1.0],
    ['wall',     'mirror_cladding',     'wall',      0.60],
    ['wall',     'acoustic_panel',      'wall',      0.25],
    ['wall',     'aep_paint',           'wall',      0.15],
    ['mep',      'electrical',          'floor',     1.0],
    ['mep',      'hvac_vrv',            'floor',     1.0],
    ['mep',      'pa_system',           'floor',     1.0],
    ['mep',      'lv_firefighting',     'floor',     1.0],
  ],
  office: [
    ['civil',    'pcc_work',            'floor',     1.0],
    ['civil',    'pop_punning',         'wall',      1.0],
    ['flooring', 'vitrified_800',       'floor',     1.0],
    ['ceiling',  'gypsum_plain',        'floor',     1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',     1.0],
    ['wall',     'aep_paint',           'wall',      0.70],
    ['wall',     'wallpaper',           'wall',      0.30],
    ['skirting', 'aluminium_50mm',      'perimeter', 1.0],
    ['doors',    'flush_900_2100',      'nos',       1.0],
    ['mep',      'electrical',          'floor',     1.0],
    ['mep',      'hvac_vrv',            'floor',     1.0],
  ],
  cabin: [
    ['civil',    'pcc_work',            'floor',     1.0],
    ['flooring', 'wooden_flooring',     'floor',     0.60],
    ['flooring', 'marble',              'floor',     0.40],
    ['ceiling',  'gypsum_with_coves',   'floor',     1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',     1.0],
    ['wall',     'premium_emulsion',    'wall',      0.60],
    ['wall',     'fluted_panel_wpc',    'wall',      0.25],
    ['wall',     'wallpaper',           'wall',      0.15],
    ['skirting', 'aluminium_50mm',      'perimeter', 1.0],
    ['doors',    'flush_900_2100',      'nos',       1.0],
    ['mep',      'electrical',          'floor',     1.0],
    ['mep',      'hvac_vrv',            'floor',     1.0],
  ],
  conference: [
    ['civil',    'pcc_work',            'floor',     1.0],
    ['flooring', 'vitrified_800',       'floor',     1.0],
    ['ceiling',  'gypsum_with_coves',   'floor',     1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',     1.0],
    ['wall',     'acoustic_panel',      'wall',      0.40],
    ['wall',     'fluted_panel_wpc',    'wall',      0.30],
    ['wall',     'aep_paint',           'wall',      0.30],
    ['skirting', 'aluminium_50mm',      'perimeter', 1.0],
    ['doors',    'flush_900_2100',      'nos',       1.0],
    ['mep',      'electrical',          'floor',     1.0],
    ['mep',      'hvac_vrv',            'floor',     1.0],
    ['mep',      'lv_firefighting',     'floor',     1.0],
    ['mep',      'pa_system',           'floor',     1.0],
  ],
  toilet: [
    ['civil',    'waterproofing',       'floor',     1.0],
    ['civil',    'rough_plaster',       'wall',      1.0],
    ['flooring', 'antiskid_vitrified',  'floor',     1.0],
    ['ceiling',  'metal_grid',          'floor',     1.0],
    ['wall',     'tile_dado',           'wall',      1.0],
    ['skirting', 'tile_skirting',       'perimeter', 1.0],
    ['doors',    'toilet_door',         'nos',       1.0],
    ['mep',      'plumbing_basic',      'floor',     1.0],
    ['mep',      'electrical',          'floor',     1.0],
  ],
  reception: [
    ['civil',    'pcc_work',            'floor',     1.0],
    ['flooring', 'marble',              'floor',     1.0],
    ['ceiling',  'gypsum_with_coves',   'floor',     1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',     1.0],
    ['wall',     'fluted_panel_wpc',    'wall',      0.50],
    ['wall',     'premium_emulsion',    'wall',      0.50],
    ['skirting', 'aluminium_50mm',      'perimeter', 1.0],
    ['mep',      'electrical',          'floor',     1.0],
    ['mep',      'hvac_vrv',            'floor',     1.0],
  ],
  banquet: [
    ['civil',    'floor_dismantling',   'floor',     1.0],
    ['civil',    'pcc_work',            'floor',     1.0],
    ['flooring', 'vitrified_800',       'floor',     1.0],
    ['ceiling',  'gypsum_with_coves',   'floor',     1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',     1.0],
    ['wall',     'fluted_panel_wpc',    'wall',      0.40],
    ['wall',     'acoustic_panel',      'wall',      0.30],
    ['wall',     'aep_paint',           'wall',      0.30],
    ['skirting', 'aluminium_50mm',      'perimeter', 1.0],
    ['mep',      'electrical',          'floor',     1.0],
    ['mep',      'hvac_vrv',            'floor',     1.0],
    ['mep',      'lv_firefighting',     'floor',     1.0],
    ['mep',      'pa_system',           'floor',     1.0],
  ],
  terrace: [
    ['civil',    'deck_slab',           'floor',     1.0],
    ['civil',    'waterproofing',       'floor',     1.0],
    ['flooring', 'antiskid_vitrified',  'floor',     1.0],
    ['ceiling',  'metal_false_ceiling', 'floor',     0.40],
    ['wall',     'exterior_paint',      'wall',      1.0],
    ['mep',      'electrical',          'floor',     1.0],
    ['mep',      'lv_firefighting',     'floor',     1.0],
  ],
  pantry: [
    ['civil',    'waterproofing',       'floor',     1.0],
    ['flooring', 'antiskid_vitrified',  'floor',     1.0],
    ['ceiling',  'metal_grid',          'floor',     1.0],
    ['wall',     'tile_dado',           'wall',      1.0],
    ['mep',      'electrical',          'floor',     1.0],
    ['mep',      'plumbing_basic',      'floor',     1.0],
  ],
  corridor: [
    ['civil',    'pcc_work',            'floor',     1.0],
    ['flooring', 'vitrified_800',       'floor',     1.0],
    ['ceiling',  'gypsum_plain',        'floor',     1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',     1.0],
    ['wall',     'aep_paint',           'wall',      1.0],
    ['skirting', 'aluminium_50mm',      'perimeter', 1.0],
    ['mep',      'electrical',          'floor',     1.0],
  ],
  storage: [
    ['civil',    'pcc_work',            'floor',     1.0],
    ['flooring', 'kota_stone',          'floor',     1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',     1.0],
    ['wall',     'aep_paint',           'wall',      1.0],
    ['mep',      'electrical',          'floor',     1.0],
  ],
  other: [
    ['civil',    'pcc_work',            'floor',     1.0],
    ['flooring', 'vitrified_800',       'floor',     1.0],
    ['ceiling',  'gypsum_plain',        'floor',     1.0],
    ['ceiling',  'ceiling_paint_aep',   'floor',     1.0],
    ['wall',     'aep_paint',           'wall',      1.0],
    ['mep',      'electrical',          'floor',     1.0],
  ],
}

export const PROJECT_TYPES = [
  'office',
  'gym',
  'hospitality',
  'retail',
  'residential',
  'clubhouse',
  'other',
] as const

export type ProjectType = (typeof PROJECT_TYPES)[number]
