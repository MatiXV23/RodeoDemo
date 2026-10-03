// Tablas de la base simulada. Replican las columnas de la base real
// (apps/api/src/db/schema.ts): montos, pesos y precios como texto decimal,
// fechas de negocio como YYYY-MM-DD e instantes como ISO 8601 en UTC.

import type { AlertConfig, FarmRole } from "@rodeo/shared";

export type UserRow = { id: string; email: string; name: string; password: string; createdAt: string };
export type PasswordResetRow = { id: string; userId: string; expiresAt: string; usedAt: string | null; createdAt: string };

export type FarmRow = {
  id: string;
  name: string;
  location: string;
  hectares: string;
  currency: string;
  weightUnit: string;
  areaUnit: string;
  timezone: string;
  allocationMethod: string;
  withdrawalPolicy: string;
  alertConfig: AlertConfig;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FarmMemberRow = { farmId: string; userId: string; role: FarmRole; createdAt: string };

export type InvitationRow = {
  id: string; // token (en la base real, su sha256)
  farmId: string;
  email: string;
  role: FarmRole;
  invitedBy: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
};

export type PaddockRow = { id: string; farmId: string; name: string; hectares: string; createdAt: string };
export type OwnerRow = { id: string; farmId: string; name: string; dicose: string | null; notes: string | null; createdAt: string };

export type LotRow = {
  id: string;
  farmId: string;
  name: string;
  category: string;
  paddockId: string | null;
  status: string;
  targetWeight: string | null;
  notes: string | null;
  color: string;
  startDate: string;
  closedAt: string | null;
  closingResult: Record<string, string | number> | null;
  createdAt: string;
  updatedAt: string;
};

export type AnimalRow = {
  id: string;
  farmId: string;
  eid: string;
  visualTag: string | null;
  sex: string;
  category: string;
  breed: string | null;
  birthDateEstimated: string | null;
  origin: string;
  status: string;
  currentLotId: string | null;
  purchaseCost: string | null;
  purchaseDate: string | null;
  ownerId: string | null;
  pledgedBank: string | null;
  pledgedRef: string | null;
  pledgedSince: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReproEventRow = {
  id: string;
  farmId: string;
  animalId: string;
  type: string;
  date: string;
  months: number | null;
  bullId: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type MembershipRow = {
  id: string;
  farmId: string;
  animalId: string;
  lotId: string;
  fromDate: string;
  toDate: string | null;
  reason: string;
  movementId: string | null;
  createdAt: string;
};

export type WeighingSessionRow = {
  id: string;
  farmId: string;
  date: string;
  name: string;
  origin: string;
  fileKey: string | null;
  fileName: string | null;
  fileHash: string | null;
  rowsHash: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type WeighingRow = {
  id: string;
  farmId: string;
  sessionId: string;
  animalId: string;
  lotId: string | null;
  weight: string;
  weighedAt: string;
  date: string;
  mode: string;
  observation: string | null;
  reliable: boolean;
  createdAt: string;
};

export type LotAverageWeighingRow = { id: string; farmId: string; sessionId: string; lotId: string; date: string; headCount: number; totalWeight: string; createdAt: string };

export type ImportBatchRow = {
  id: string;
  farmId: string;
  fileKey: string | null;
  fileName: string;
  fileHash: string;
  rowsHash: string;
  status: string;
  rows: unknown[];
  decisions: unknown;
  sessionId: string | null;
  createdBy: string | null;
  createdAt: string;
  confirmedAt: string | null;
};

export type MovementRow = {
  id: string;
  farmId: string;
  type: string;
  date: string;
  counterparty: string | null;
  headCount: number;
  totalWeight: string | null;
  priceMode: string | null;
  unitPrice: string | null;
  currency: string | null;
  commission: string | null;
  freight: string | null;
  grossAmount: string | null;
  netAmount: string | null;
  documentRef: string | null;
  notes: string | null;
  cause: string | null;
  fromLotId: string | null;
  toLotId: string | null;
  toFarmId: string | null;
  allocatedCost: string | null;
  result: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
};

export type MovementAnimalRow = { movementId: string; animalId: string; weight: string | null; amount: string | null; costBasis: string | null };

export type ExpenseRow = {
  id: string;
  farmId: string;
  category: string;
  subcategory: string | null;
  description: string;
  supplier: string | null;
  date: string;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  total: string;
  currency: string;
  receiptKey: string | null;
  receiptName: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseAllocationRow = { id: string; farmId: string; expenseId: string; lotId: string | null; percentage: string };

export type HealthEventRow = {
  id: string;
  farmId: string;
  type: string;
  product: string;
  dose: string | null;
  date: string;
  lotId: string | null;
  scope: string;
  withdrawalDays: number;
  expenseId: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type HealthEventAnimalRow = { eventId: string; animalId: string; withdrawalUntil: string | null };

export type ReminderRow = {
  id: string;
  farmId: string;
  title: string;
  dueDate: string;
  lotId: string | null;
  eventId: string | null;
  notes: string | null;
  doneAt: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type MarketPriceRow = {
  id: string;
  farmId: string;
  date: string;
  category: string;
  pricePerKg: string;
  currency: string;
  source: string;
  provider: string | null;
  basis: string;
  createdAt: string;
};

export type MailRow = { id: string; to: string; subject: string; body: string; link: string | null; createdAt: string };
export type SyncOpRow = { clientId: string; farmId: string; userId: string; kind: string; status: string; result: unknown; createdAt: string };

export type Tables = {
  users: UserRow[];
  passwordResets: PasswordResetRow[];
  farms: FarmRow[];
  farmMembers: FarmMemberRow[];
  invitations: InvitationRow[];
  paddocks: PaddockRow[];
  owners: OwnerRow[];
  lots: LotRow[];
  animals: AnimalRow[];
  reproEvents: ReproEventRow[];
  lotMemberships: MembershipRow[];
  weighingSessions: WeighingSessionRow[];
  weighings: WeighingRow[];
  lotAverageWeighings: LotAverageWeighingRow[];
  importBatches: ImportBatchRow[];
  movements: MovementRow[];
  movementAnimals: MovementAnimalRow[];
  expenses: ExpenseRow[];
  expenseAllocations: ExpenseAllocationRow[];
  healthEvents: HealthEventRow[];
  healthEventAnimals: HealthEventAnimalRow[];
  healthReminders: ReminderRow[];
  marketPrices: MarketPriceRow[];
  mailOutbox: MailRow[];
  syncOps: SyncOpRow[];
};

export const emptyTables = (): Tables => ({
  users: [],
  passwordResets: [],
  farms: [],
  farmMembers: [],
  invitations: [],
  paddocks: [],
  owners: [],
  lots: [],
  animals: [],
  reproEvents: [],
  lotMemberships: [],
  weighingSessions: [],
  weighings: [],
  lotAverageWeighings: [],
  importBatches: [],
  movements: [],
  movementAnimals: [],
  expenses: [],
  expenseAllocations: [],
  healthEvents: [],
  healthEventAnimals: [],
  healthReminders: [],
  marketPrices: [],
  mailOutbox: [],
  syncOps: [],
});
