import { ReactNode } from "react";
import { ArrowUpRight, Sprout, Baby, Landmark, Bug, HeartHandshake } from "lucide-react";
import type { AnimalView } from "@rodeo/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Sprout size={25} />
      </span>
      rodeo<span className="brand-dot">.</span>
      <span className="demo-pill brand-demo" title="Demo con datos de ejemplo">DEMO</span>
    </div>
  );
}
export function Btn({
  children,
  onClick,
  variant = "",
  type = "button",
  disabled = false,
  ...props
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  [key: string]: unknown;
}) {
  return (
    <button
      type={type}
      className={`btn ${variant}`}
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
export function Pick({
  value,
  onChange,
  options,
  label,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[] | { value: string; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={`pick ${className}`}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem
            key={typeof o === "string" ? o : o.value}
            value={typeof o === "string" ? o : o.value}
          >
            {typeof o === "string" ? o : o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function Badge({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
/** Etiquetas de situación del animal: retiro, preñez, entore, prenda bancaria y enfermedad. */
export function AnimalBadges({ animal: a, compact = true }: { animal: AnimalView; compact?: boolean }) {
  return (
    <>
      {a.withdrawalUntil && <Badge tone="amber">Retiro</Badge>}
      {a.repro?.pregnant && (
        <Badge tone="green">
          <Baby size={12} /> {compact ? "Preñada" : `Preñada · ${a.repro.months ?? 0} m`}
        </Badge>
      )}
      {a.repro?.inService && (
        <Badge tone="blue">
          <HeartHandshake size={12} /> Entore
        </Badge>
      )}
      {a.pledge && (
        <Badge tone="amber">
          <Landmark size={12} /> {compact ? "Banco" : a.pledge.bank}
        </Badge>
      )}
      {a.diseases.length > 0 && (
        <Badge tone="red">
          <Bug size={12} /> {compact ? "Enfermo" : a.diseases.map((d) => d.product).join(", ")}
        </Badge>
      )}
    </>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Metric({
  label,
  value,
  unit,
  icon,
  foot,
  change,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: ReactNode;
  foot: string;
  change?: string;
}) {
  return (
    <div className="metric">
      <div className="metric-top">
        {label}
        <span>{icon}</span>
      </div>
      <div className="metric-value">
        {value}
        <small>{unit}</small>
      </div>
      <div className="metric-foot">
        {change && (
          <span>
            <ArrowUpRight size={14} />
            {change}
          </span>
        )}
        {foot}
      </div>
    </div>
  );
}
export function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <Table className="data-table">
      <TableHeader>
        <TableRow>
          {headers.map((h, i) => (
            <TableHead key={i}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            {r.map((c, j) => (
              <TableCell key={j}>{c}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Sprout size={32} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
