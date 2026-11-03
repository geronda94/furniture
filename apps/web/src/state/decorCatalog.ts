// AUTO-GENERATED from specs/decor.yaml by tools/gen_decor_catalog.py.
// Do not edit by hand. Change specs/decor.yaml and regenerate.

export const DECOR_GROUPS = [
  { id: "soft", label: "Мягкая мебель" },
  { id: "beds", label: "Кровати" },
  { id: "tables", label: "Столы и стулья" },
  { id: "storage", label: "Корпусная мебель" },
  { id: "tech", label: "Техника" },
  { id: "bath", label: "Сантехника" },
  { id: "decor", label: "Декор" },
] as const

export type DecorCategory = (typeof DECOR_GROUPS)[number]['id']

export const DECOR_TYPES = [
  "sofa",
  "armchair",
  "bed",
  "coffee-table",
  "chair",
  "dresser",
  "fridge",
  "stove",
  "sink",
  "tv",
  "hood",
  "toilet",
  "bathtub",
  "vanity",
  "shower",
  "lamp",
  "plant",
  "rug",
] as const

export type DecorType = (typeof DECOR_TYPES)[number]

export interface DecorPreset {
  key: string
  type: DecorType
  name: string
  category: DecorCategory
  group: string
  w: number
  d: number
  h: number
  color: string
  accent?: string
  icon: string
}

export const DECOR_PRESETS: DecorPreset[] = [
  { key: "sofa-small", type: "sofa", name: "Диван 2-местный", category: "soft", group: "Мягкая мебель", w: 1600, d: 900, h: 850, color: "#5f6a72", accent: "#9aa5ad", icon: "🛋" },
  { key: "sofa", type: "sofa", name: "Диван 3-местный", category: "soft", group: "Мягкая мебель", w: 2200, d: 950, h: 850, color: "#5f6a72", accent: "#9aa5ad", icon: "🛋" },
  { key: "sofa-compact", type: "sofa", name: "Диван компакт", category: "soft", group: "Мягкая мебель", w: 1200, d: 850, h: 820, color: "#6d7379", accent: "#9aa5ad", icon: "🛋" },
  { key: "armchair", type: "armchair", name: "Кресло", category: "soft", group: "Мягкая мебель", w: 850, d: 850, h: 800, color: "#6b6f64", accent: "#a3a795", icon: "🪑" },
  { key: "armchair-xl", type: "armchair", name: "Кресло широкое", category: "soft", group: "Мягкая мебель", w: 950, d: 900, h: 820, color: "#6b6f64", accent: "#a3a795", icon: "🪑" },
  { key: "bed-90", type: "bed", name: "Кровать 900", category: "beds", group: "Кровати", w: 900, d: 2000, h: 900, color: "#8d7a66", accent: "#c8b6a2", icon: "🛏" },
  { key: "bed-120", type: "bed", name: "Кровать 1200", category: "beds", group: "Кровати", w: 1200, d: 2000, h: 900, color: "#8d7a66", accent: "#c8b6a2", icon: "🛏" },
  { key: "bed", type: "bed", name: "Кровать 1600", category: "beds", group: "Кровати", w: 1600, d: 2000, h: 900, color: "#8d7a66", accent: "#c8b6a2", icon: "🛏" },
  { key: "bed-180", type: "bed", name: "Кровать 1800", category: "beds", group: "Кровати", w: 1800, d: 2000, h: 900, color: "#8d7a66", accent: "#c8b6a2", icon: "🛏" },
  { key: "dining-table", type: "coffee-table", name: "Обеденный стол 1600", category: "tables", group: "Столы и стулья", w: 1600, d: 900, h: 750, color: "#7b6652", accent: "#a68b6c", icon: "🪵" },
  { key: "dining-table-1200", type: "coffee-table", name: "Обеденный стол 1200", category: "tables", group: "Столы и стулья", w: 1200, d: 800, h: 750, color: "#7b6652", accent: "#a68b6c", icon: "🪵" },
  { key: "coffee-table", type: "coffee-table", name: "Журнальный стол", category: "tables", group: "Столы и стулья", w: 1100, d: 650, h: 420, color: "#7b6652", accent: "#a68b6c", icon: "🪵" },
  { key: "chair", type: "chair", name: "Стул", category: "tables", group: "Столы и стулья", w: 450, d: 480, h: 850, color: "#8a6b4f", accent: "#b08a63", icon: "🪑" },
  { key: "bar-chair", type: "chair", name: "Барный стул", category: "tables", group: "Столы и стулья", w: 450, d: 500, h: 1050, color: "#8a6b4f", accent: "#b08a63", icon: "🪑" },
  { key: "dresser", type: "dresser", name: "Комод", category: "storage", group: "Корпусная мебель", w: 1000, d: 450, h: 900, color: "#7b6652", accent: "#a68b6c", icon: "🗄" },
  { key: "tv-stand", type: "dresser", name: "ТВ-тумба", category: "storage", group: "Корпусная мебель", w: 1800, d: 450, h: 500, color: "#7b6652", accent: "#a68b6c", icon: "🗄" },
  { key: "fridge", type: "fridge", name: "Холодильник", category: "tech", group: "Техника", w: 700, d: 650, h: 1850, color: "#c8ccd0", accent: "#9aa0a5", icon: "🧊" },
  { key: "stove", type: "stove", name: "Плита", category: "tech", group: "Техника", w: 600, d: 560, h: 850, color: "#2b2f33", accent: "#6b7378", icon: "🔥" },
  { key: "sink", type: "sink", name: "Мойка", category: "tech", group: "Техника", w: 800, d: 560, h: 850, color: "#c8ccd0", accent: "#9aa0a5", icon: "🚰" },
  { key: "tv", type: "tv", name: "Телевизор", category: "tech", group: "Техника", w: 1500, d: 90, h: 850, color: "#121417", icon: "📺" },
  { key: "hood", type: "hood", name: "Вытяжка", category: "tech", group: "Техника", w: 600, d: 500, h: 600, color: "#b9c0c5", accent: "#7c858c", icon: "💨" },
  { key: "toilet", type: "toilet", name: "Унитаз", category: "bath", group: "Сантехника", w: 450, d: 650, h: 780, color: "#f0f1ec", accent: "#d5d7d0", icon: "🚽" },
  { key: "bathtub", type: "bathtub", name: "Ванна", category: "bath", group: "Сантехника", w: 1700, d: 800, h: 560, color: "#f0f1ec", accent: "#d5d7d0", icon: "🛁" },
  { key: "vanity", type: "vanity", name: "Тумба с раковиной", category: "bath", group: "Сантехника", w: 1200, d: 550, h: 850, color: "#f0f1ec", accent: "#d5d7d0", icon: "🚿" },
  { key: "shower", type: "shower", name: "Душевая", category: "bath", group: "Сантехника", w: 1000, d: 900, h: 2100, color: "#cfd4d8", accent: "#9aa0a5", icon: "🚿" },
  { key: "lamp", type: "lamp", name: "Торшер", category: "decor", group: "Декор", w: 350, d: 350, h: 1650, color: "#e8dcc4", accent: "#c9b489", icon: "💡" },
  { key: "plant", type: "plant", name: "Растение", category: "decor", group: "Декор", w: 450, d: 450, h: 1200, color: "#4e7a45", accent: "#3d6236", icon: "🪴" },
  { key: "rug", type: "rug", name: "Ковёр", category: "decor", group: "Декор", w: 2000, d: 1500, h: 12, color: "#8d7f70", icon: "🟫" },
]
