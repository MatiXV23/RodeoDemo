// Tipos del contrato API ↔ interfaz. El servidor arma un "snapshot" del campo
// activo con todo lo que las vistas necesitan; el cliente solo lo muestra.

export const FARM_ROLES = ["owner", "admin", "operator", "viewer"] as const;
export type FarmRole = (typeof FARM_ROLES)[number];
export type Role = FarmRole;

/** Configuración de alertas del campo (JSON en la base). */
export type AlertConfig = {
  staleDays: number;
  withdrawalSoonDays: number;
  calvingSoonDays?: number; // aviso de partos estimados próximos (por defecto 30)
  email: boolean;
};

export type AlertType = "sin_pesar" | "peso_objetivo" | "retiro_por_vencer" | "retiro_vigente" | "importacion_pendiente" | "recordatorio" | "parto_proximo" | "entore_sin_diagnostico";

export type Alert = {
  id: string;
  type: AlertType;
  severity: "info" | "warning" | "success";
  title: string;
  description: string;
  lotId?: string | null;
  animalId?: string | null;
  entityId?: string | null;
  date?: string | null;
};

export type FarmSummary = {
  id: string;
  name: string;
  location: string;
  hectares: number;
  currency: string;
  timezone: string;
  role: Role;
  lots: number;
  animals: number;
};

export type LotCosts = {
  purchase: number;
  expenses: number;
  direct: number;
  allocated: number;
  current: number;
  deathLoss: number;
  total: number;
  perHead: number;
  perKgProduced: number | null;
  fullPerKgProduced: number | null;
  perKgLive: number | null; // costo acumulado / kg en pie (precio de equilibrio)
  dailyPerHead: number;
};

export type LotView = {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  status: "activo" | "cerrado";
  color: string;
  target: number | null;
  startDate: string;
  paddockId: string | null;
  paddockName: string | null;
  notes: string | null;
  count: number;
  weight: number | null; // promedio última pesada
  totalWeight: number;
  gain: number | null; // GDP promedio ponderado del período
  trendGain: number | null;
  kgProduced: number;
  lastWeighingDate: string | null;
  avgDaysInLot: number | null;
  history: { date: string; avgWeight: number; count: number }[];
  categoryCounts: Record<string, number>;
  soldHeads: number;
  deadHeads: number;
  closedAt: string | null;
  closingResult: Record<string, string | number> | null;
  projection: { gdpUsed: number | null; gdpSource: string; points: { days: number; date: string; weight: number }[]; daysToTarget: number | null };
  // Solo para roles con acceso a montos:
  costs: LotCosts | null;
  marketPrice: number | null;
  marketValue: number | null;
  estimatedMargin: number | null;
  revenue: number | null;
  realizedResult: number | null;
};

export type AnimalView = {
  id: string;
  eid: string;
  visual: string;
  sex: string;
  category: string;
  breed: string | null;
  birthDate: string | null;
  origin: string;
  status: string;
  lot: string | null;
  weight: number | null;
  lastDate: string | null;
  gain: number | null;
  daysInLot: number | null;
  withdrawalUntil: string | null;
  purchaseDate: string | null;
  notes: string | null;
  cost: number | null; // costo acumulado (solo con acceso a montos)
  purchaseCost: number | null;
  owner: { id: string; name: string; dicose: string | null } | null;
  pledge: { bank: string; ref: string | null; since: string | null } | null; // a nombre del banco por préstamo
  repro: ReproView | null; // solo hembras con eventos
  diseases: { product: string; date: string }[]; // enfermedades detectadas vigentes
};

export type ReproView = {
  pregnant: boolean;
  months: number | null; // meses de gestación estimados a hoy
  checkedAt: string | null;
  expectedCalving: string | null;
  daysToCalving: number | null;
  inService: boolean;
  serviceSince: string | null;
  bullId: string | null;
  bullEid: string | null;
  lastCalving: string | null;
  lastEventType: string | null;
  lastEventDate: string | null;
};

export type OwnerView = { id: string; name: string; dicose: string | null; notes: string | null; activeAnimals: number; pledgedAnimals: number };

export type SessionView = {
  id: string;
  date: string;
  name: string;
  origin: string;
  count: number;
  avgWeight: number | null;
  lotIds: string[];
  fileName: string | null;
  notes: string | null;
  createdAt: string;
};

export type ExpenseView = {
  id: string;
  date: string;
  category: string;
  subcategory: string | null;
  description: string;
  supplier: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  total: number | null;
  currency: string;
  receiptName: string | null;
  receiptKey: string | null;
  notes: string | null;
  allocations: { lotId: string | null; percentage: number }[];
  lot: string; // "global" o id del lote principal (para filtros)
};

export type HealthView = {
  id: string;
  date: string;
  type: string;
  product: string;
  dose: string | null;
  lotId: string | null;
  lotName: string | null;
  scope: string;
  withdrawalDays: number;
  withdrawalUntil: string | null;
  withdrawalActive: boolean;
  animalCount: number;
  animalIds: string[];
  expenseId: string | null;
  notes: string | null;
};

export type MovementView = {
  id: string;
  date: string;
  type: string;
  typeLabel: string;
  counterparty: string | null;
  headCount: number;
  totalWeight: number | null;
  priceMode: string | null;
  unitPrice: number | null;
  currency: string | null;
  commission: number | null;
  freight: number | null;
  grossAmount: number | null;
  netAmount: number | null;
  allocatedCost: number | null;
  result: number | null;
  documentRef: string | null;
  notes: string | null;
  cause: string | null;
  fromLotId: string | null;
  toLotId: string | null;
  toFarmId: string | null;
  lot: string; // lote de referencia para filtros
  createdAt: string;
  updatedAt: string;
};

export type ReminderView = { id: string; title: string; dueDate: string; lotId: string | null; lotName: string | null; notes: string | null; doneAt: string | null };

export type PriceView = { category: string; pricePerKg: number; date: string; source: string; currency: string };

export type FarmSnapshot = {
  farm: {
    id: string;
    name: string;
    location: string;
    hectares: number;
    currency: string;
    weightUnit: string;
    timezone: string;
    allocationMethod: string;
    withdrawalPolicy: string;
    alertConfig: AlertConfig;
    createdAt: string;
  };
  role: Role;
  today: string;
  lots: LotView[];
  animals: AnimalView[];
  sessions: SessionView[];
  expenses: ExpenseView[];
  health: HealthView[];
  movements: MovementView[];
  reminders: ReminderView[];
  prices: Record<string, PriceView>;
  alerts: Alert[];
  pendingImports: { id: string; fileName: string; createdAt: string }[];
  paddocks: { id: string; name: string; hectares: number }[];
  owners: OwnerView[];
  totals: { activeHeads: number; totalWeight: number; avgGdp: number | null; expensesAllTime: number | null; activeLots: number; pregnant: number; inService: number; pledged: number; sick: number };
};

export type SessionUserView = { id: string; email: string; name: string };
