import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  ReferenceLine,
} from "recharts";
import { fmt, dateLabel } from "@/lib/format";
import type { LotView } from "@rodeo/shared";

export type WeightPoint = { date: string; weight: number; count?: number };

/** Evolución del peso promedio a partir de las sesiones reales. */
export function WeightChart({ points, target }: { points: WeightPoint[]; target?: number | null }) {
  const data = points.map((p) => ({ ...p, name: dateLabel(p.date) }));
  if (data.length < 2) {
    return (
      <div className="weight-chart chart-empty">
        <p className="form-note">{data.length === 1 ? "Con una sola pesada todavía no hay evolución que mostrar." : "Registrá pesadas para ver la evolución del peso."}</p>
      </div>
    );
  }
  const weights = data.map((p) => p.weight).concat(target ? [target] : []);
  const min = Math.floor((Math.min(...weights) * 0.9) / 25) * 25;
  const max = Math.ceil((Math.max(...weights) * 1.05) / 25) * 25;
  return (
    <div className="weight-chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={data} margin={{ top: 15, right: 14, left: -25, bottom: 0 }}>
          <defs>
            <linearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#527e61" stopOpacity={0.16} />
              <stop offset="100%" stopColor="#527e61" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#e9ece7" strokeDasharray="4 4" />
          <XAxis dataKey="name" axisLine={false} tickLine={false} tickMargin={14} tick={{ fill: "#828b82", fontSize: 12 }} />
          <YAxis domain={[min, max]} tickCount={5} axisLine={false} tickLine={false} tick={{ fill: "#828b82", fontSize: 12 }} />
          <Tooltip
            formatter={(v, _n, item) => [`${fmt(Number(v), 1)} kg${item?.payload?.count ? ` · ${item.payload.count} animales` : ""}`, "Peso promedio"]}
            contentStyle={{ borderRadius: 10, border: "1px solid #e2e7df", fontSize: 14 }}
          />
          {target ? <ReferenceLine y={target} stroke="#c29b63" strokeDasharray="5 5" label={{ value: `Objetivo ${target} kg`, fill: "#9a7a4a", fontSize: 12, position: "insideTopRight" }} /> : null}
          <Area type="monotone" dataKey="weight" stroke="#437556" strokeWidth={2.5} fill="url(#weightFill)" activeDot={{ r: 5, stroke: "white", strokeWidth: 3 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Composition({ lots }: { lots: LotView[] }) {
  const total = lots.reduce((s, l) => s + l.count, 0);
  return (
    <div className="composition">
      <div className="donut">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <PieChart>
            <Pie data={lots} dataKey="count" nameKey="categoryLabel" innerRadius={67} outerRadius={88} paddingAngle={4} stroke="none" startAngle={90} endAngle={-270}>
              {lots.map((l) => (
                <Cell key={l.id} fill={l.color} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => [v, "animales"]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-label">
          <strong>{fmt(total)}</strong>
          <span>animales</span>
        </div>
      </div>
      <div className="composition-legend">
        {lots.map((l) => (
          <div key={l.id}>
            <i style={{ background: l.color }} />
            <span>{l.name}</span>
            <strong>{l.count}</strong>
            <small>{total ? Math.round((l.count / total) * 100) : 0}%</small>
          </div>
        ))}
      </div>
    </div>
  );
}

export type MarketPoint = { date: string; market: number | null; carcass?: number | null; cost: number | null };

const MARKET_SERIES: Record<string, string> = { market: "Precio en pie", carcass: "Precio 4ta balanza", cost: "Costo por kg en pie" };

/**
 * Precio de referencia vs. costo por kg en pie del lote (ambos reales). El precio
 * de ganado gordo (4ta balanza, ACG) se dibuja aparte porque no es comparable con kilos vivos.
 */
export function MarketChart({ points, currency = "US$" }: { points: MarketPoint[]; currency?: string }) {
  const data = points.map((p) => ({ ...p, name: dateLabel(p.date) }));
  if (!data.length) return <div className="market-chart chart-empty"><p className="form-note">Cargá precios de referencia para ver la evolución del mercado.</p></div>;
  const hasCarcass = data.some((p) => p.carcass !== null && p.carcass !== undefined);
  const values = data.flatMap((p) => [p.market, p.carcass ?? null, p.cost]).filter((v): v is number => v !== null);
  const min = Number((Math.floor(Math.min(...values) * 10) / 10 - 0.1).toFixed(2));
  const max = Number((Math.ceil(Math.max(...values) * 10) / 10 + 0.1).toFixed(2));
  return (
    <div className="market-chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={data} margin={{ top: 20, right: 25, left: 0, bottom: 10 }}>
          <CartesianGrid stroke="#e5eadf" vertical={false} strokeDasharray="4 4" />
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#75896b", fontSize: 13 }} />
          <YAxis domain={[min, max]} tick={{ fill: "#75896b", fontSize: 13 }} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(Number(v), 2)} />
          <Tooltip formatter={(v, name) => [`${currency} ${fmt(Number(v), 2)} / kg`, MARKET_SERIES[String(name)] ?? String(name)]} />
          <Area dataKey="market" fill="#527e6110" stroke="#527e61" strokeWidth={3} connectNulls />
          {hasCarcass && <Area dataKey="carcass" fill="transparent" stroke="#7d5a9b" strokeWidth={2} connectNulls />}
          <Area dataKey="cost" fill="transparent" stroke="#c29b63" strokeWidth={2} strokeDasharray="5 5" connectNulls />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export type MarginPoint = { days: number; date: string; margin: number; marginMinus?: number; marginPlus?: number };

/** Curva del simulador de venta: margen por fecha con banda de sensibilidad. */
export function MarginChart({ points, currency = "US$" }: { points: MarginPoint[]; currency?: string }) {
  const data = points.map((p) => ({ ...p, name: dateLabel(p.date) }));
  return (
    <div className="market-chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={data} margin={{ top: 20, right: 25, left: 0, bottom: 10 }}>
          <CartesianGrid stroke="#e5eadf" vertical={false} strokeDasharray="4 4" />
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#75896b", fontSize: 12 }} minTickGap={30} />
          <YAxis tick={{ fill: "#75896b", fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(Number(v) / 1000, 1) + "k"} />
          <Tooltip formatter={(v, name) => [`${currency} ${fmt(Number(v))}`, name === "margin" ? "Margen" : name === "marginMinus" ? "Precio −10%" : "Precio +10%"]} />
          <ReferenceLine y={0} stroke="#b45c5c" strokeDasharray="4 4" />
          <Area dataKey="marginPlus" fill="transparent" stroke="#9eaf70" strokeWidth={1.5} strokeDasharray="4 4" />
          <Area dataKey="marginMinus" fill="transparent" stroke="#c29b63" strokeWidth={1.5} strokeDasharray="4 4" />
          <Area dataKey="margin" fill="#527e6118" stroke="#527e61" strokeWidth={3} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
