"use client";
/**
 * Audit-log compliance page.
 *
 * Wires GET /api/v1/audit and GET /api/v1/audit/{id}. Reads the workspace
 * append-only trail required by SEC Rule 17a-4. Read-only by design — the
 * backend has a BEFORE UPDATE trigger that blocks mutation, so there is
 * no edit/delete UI here.
 *
 * Filter UX:
 *   - Action verb dropdown (UPLOAD / VIEW / DOWNLOAD / DELETE / QUERY / …)
 *   - Resource-type dropdown (document / query / workspace / …)
 *   - "Last N days" range chip
 *   - Pagination controls
 *
 * Click any row to inline-expand the full `audit_metadata` JSON. Heavy
 * detail (failed status codes, IPs, user agents) lives in that drawer
 * to keep the table readable.
 */
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, AlertCircle, ChevronDown, RefreshCw, ChevronRight,
  Filter, Globe, Loader2, FileText, Trash2, Pencil, Download,
  Eye, Database, Activity,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IS_LIVE_API,
  listAuditLogs,
  type AuditLogOut,
  type PaginatedList,
} from "@/lib/api";
import { useWorkspaceId } from "@/lib/use-workspace";
import { cn, formatNumber, relativeTime } from "@/lib/utils";

const ACTION_OPTIONS = [
  { value: "",         label: "All actions" },
  { value: "UPLOAD",   label: "Upload" },
  { value: "DOWNLOAD", label: "Download" },
  { value: "VIEW",     label: "View" },
  { value: "DELETE",   label: "Delete" },
  { value: "UPDATE",   label: "Update" },
  { value: "QUERY",    label: "Query" },
  { value: "LOGIN",    label: "Login" },
];

const RESOURCE_OPTIONS = [
  { value: "",          label: "All resources" },
  { value: "document",  label: "Document" },
  { value: "query",     label: "Query" },
  { value: "workspace", label: "Workspace" },
  { value: "user",      label: "User" },
  { value: "alert",     label: "Alert" },
];

const RANGE_OPTIONS: Array<{ days: number | null; label: string }> = [
  { days: 1,    label: "Last 24h" },
  { days: 7,    label: "Last 7d" },
  { days: 30,   label: "Last 30d" },
  { days: 90,   label: "Last 90d" },
  { days: null, label: "All time" },
];

const ACTION_ICON: Record<string, React.ElementType> = {
  UPLOAD:   Download,
  DOWNLOAD: Download,
  VIEW:     Eye,
  DELETE:   Trash2,
  UPDATE:   Pencil,
  QUERY:    Database,
  LOGIN:    Activity,
};

const ACTION_COLOR: Record<string, string> = {
  UPLOAD:   "text-emerald-300 bg-emerald-500/10",
  DOWNLOAD: "text-blue-300 bg-blue-500/10",
  VIEW:     "text-fin-300 bg-fin-500/10",
  DELETE:   "text-red-300 bg-red-500/10",
  UPDATE:   "text-amber-300 bg-amber-500/10",
  QUERY:    "text-violet-300 bg-violet-500/10",
  LOGIN:    "text-slate-300 bg-slate-500/10",
};

const PAGE_SIZE = 50;

export default function AuditPage() {
  const workspaceId = useWorkspaceId();
  const { getToken } = useAuth();
  const liveEnabled = IS_LIVE_API && Boolean(workspaceId);

  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [rangeDays, setRangeDays] = useState<number | null>(30);
  const [page, setPage] = useState(1);

  // Compute the ISO `since` boundary from the chip so the backend can use
  // its time-series index. `until` is left unset (= now) since the table
  // is naturally append-only and we only ever look backwards.
  const sinceIso = useMemo(() => {
    if (rangeDays == null) return undefined;
    const d = new Date();
    d.setDate(d.getDate() - rangeDays);
    return d.toISOString();
  }, [rangeDays]);

  const auditQuery = useQuery<PaginatedList<AuditLogOut>>({
    queryKey: ["audit-logs", workspaceId, action, resourceType, sinceIso, page],
    queryFn: () =>
      listAuditLogs(
        {
          workspace_id: workspaceId!,
          action: action || undefined,
          resource_type: resourceType || undefined,
          since: sinceIso,
          page,
          page_size: PAGE_SIZE,
        },
        getToken,
      ),
    enabled: liveEnabled,
    staleTime: 15_000,
  });

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Audit Trail"
        subtitle="Immutable compliance log · SEC Rule 17a-4"
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* ── Filter bar ──────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="gradient-card p-4 flex items-center gap-3 flex-wrap"
        >
          <div className="flex items-center gap-2 mr-2 text-xs text-muted-foreground">
            <Filter className="w-3.5 h-3.5" /> Filters
          </div>

          <FilterSelect
            label="Action"
            value={action}
            onChange={(v) => {
              setAction(v);
              setPage(1);
            }}
            options={ACTION_OPTIONS}
          />

          <FilterSelect
            label="Resource"
            value={resourceType}
            onChange={(v) => {
              setResourceType(v);
              setPage(1);
            }}
            options={RESOURCE_OPTIONS}
          />

          <div className="flex items-center gap-1 ml-2">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.label}
                onClick={() => {
                  setRangeDays(r.days);
                  setPage(1);
                }}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                  rangeDays === r.days
                    ? "bg-fin-500/20 text-fin-300"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-3">
            {auditQuery.data && (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                {formatNumber(auditQuery.data.total)} events
              </Badge>
            )}
            <button
              onClick={() => auditQuery.refetch()}
              disabled={auditQuery.isFetching || !liveEnabled}
              className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
              aria-label="Refresh audit log"
            >
              <RefreshCw
                className={cn(
                  "w-3.5 h-3.5",
                  auditQuery.isFetching && "animate-spin",
                )}
              />
            </button>
          </div>
        </motion.div>

        {/* ── Body ────────────────────────────────────────────────────── */}
        {!liveEnabled && (
          <div className="gradient-card p-8 flex flex-col items-center text-center gap-2">
            <Shield className="w-6 h-6 text-fin-400" />
            <p className="text-sm font-medium">Compliance trail unavailable</p>
            <p className="text-xs text-muted-foreground max-w-sm">
              Connect a backend (set{" "}
              <code className="text-fin-300">NEXT_PUBLIC_API_URL</code>) and
              sign in to view your workspace's audit log.
            </p>
          </div>
        )}

        {liveEnabled && auditQuery.isLoading && (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        )}

        {liveEnabled && auditQuery.isError && (
          <div className="gradient-card p-5 flex items-start gap-2 border border-red-500/20 bg-red-500/5">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-medium text-red-300">Could not load audit log</p>
              <p className="text-muted-foreground">
                {(auditQuery.error as Error)?.message ?? "Backend unavailable."}
              </p>
            </div>
          </div>
        )}

        {liveEnabled && auditQuery.data && auditQuery.data.items.length === 0 && (
          <div className="gradient-card p-8 flex flex-col items-center text-center gap-2">
            <Shield className="w-6 h-6 text-muted-foreground/60" />
            <p className="text-sm">No audit events match these filters.</p>
            <p className="text-xs text-muted-foreground">
              Try widening the date range or clearing the action filter.
            </p>
          </div>
        )}

        {liveEnabled && auditQuery.data && auditQuery.data.items.length > 0 && (
          <div className="space-y-2">
            {auditQuery.data.items.map((row) => (
              <AuditRow key={row.id} row={row} />
            ))}
          </div>
        )}

        {/* ── Pagination footer ───────────────────────────────────────── */}
        {liveEnabled && auditQuery.data && auditQuery.data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-3 border-t border-white/[0.05]">
            <span className="text-xs text-muted-foreground">
              Page {page} · showing {auditQuery.data.items.length} of{" "}
              {formatNumber(auditQuery.data.total)}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1 || auditQuery.isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="text-xs h-7"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!auditQuery.data.has_next || auditQuery.isFetching}
                onClick={() => setPage((p) => p + 1)}
                className="text-xs h-7 gap-1.5"
              >
                {auditQuery.isFetching && (
                  <Loader2 className="w-3 h-3 animate-spin" />
                )}
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Subcomponents
 * ────────────────────────────────────────────────────────────────────── */

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none h-8 pl-3 pr-8 rounded-md border border-white/[0.07] bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-fin-500/40"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
      </div>
    </label>
  );
}

function AuditRow({ row }: { row: AuditLogOut }) {
  const [expanded, setExpanded] = useState(false);
  const ActionIcon = ACTION_ICON[row.action] ?? FileText;
  const colorClass = ACTION_COLOR[row.action] ?? "text-slate-300 bg-slate-500/10";
  const created = new Date(row.created_at);

  // Pull a few well-known keys out of audit_metadata for the summary line;
  // the rest is shown in the JSON drawer when expanded.
  const meta = row.audit_metadata ?? {};
  const filename = typeof meta.filename === "string" ? meta.filename : null;
  const ticker = typeof meta.ticker === "string" ? meta.ticker : null;
  const docType = typeof meta.doc_type === "string" ? meta.doc_type : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-white/[0.07] bg-card hover:border-white/[0.14] transition-colors overflow-hidden"
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left"
      >
        <ChevronRight
          className={cn(
            "w-3.5 h-3.5 text-muted-foreground flex-shrink-0 transition-transform",
            expanded && "rotate-90",
          )}
        />

        <div
          className={cn(
            "w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0",
            colorClass,
          )}
        >
          <ActionIcon className="w-3.5 h-3.5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-semibold">{row.action}</span>
            <span className="text-xs text-muted-foreground">{row.resource_type}</span>
            {ticker && (
              <Badge variant="outline" className="text-[9px] py-0 px-1.5">
                {ticker}
              </Badge>
            )}
            {docType && (
              <Badge variant="outline" className="text-[9px] py-0 px-1.5">
                {docType}
              </Badge>
            )}
            <StatusBadge code={row.status_code} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            {filename ?? row.resource_id ?? "—"}
          </p>
        </div>

        <div className="text-right text-[10px] text-muted-foreground flex-shrink-0">
          <div>{relativeTime(created)}</div>
          <div className="font-mono opacity-70">
            {created.toLocaleString()}
          </div>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-white/[0.05] bg-white/[0.01]"
          >
            <div className="px-4 py-3 space-y-2 text-xs">
              <DetailRow label="Audit ID">
                <code className="font-mono text-muted-foreground">{row.id}</code>
              </DetailRow>
              {row.workspace_id && (
                <DetailRow label="Workspace">
                  <code className="font-mono text-muted-foreground">
                    {row.workspace_id}
                  </code>
                </DetailRow>
              )}
              {row.user_id && (
                <DetailRow label="User">
                  <code className="font-mono text-muted-foreground">
                    {row.user_id}
                  </code>
                </DetailRow>
              )}
              {row.resource_id && (
                <DetailRow label="Resource ID">
                  <code className="font-mono text-muted-foreground">
                    {row.resource_id}
                  </code>
                </DetailRow>
              )}
              {row.ip_address && (
                <DetailRow label="IP">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Globe className="w-3 h-3" /> {row.ip_address}
                  </span>
                </DetailRow>
              )}
              {row.user_agent && (
                <DetailRow label="User-Agent">
                  <span className="text-muted-foreground break-all">
                    {row.user_agent}
                  </span>
                </DetailRow>
              )}
              {row.request_id && (
                <DetailRow label="Request ID">
                  <code className="font-mono text-muted-foreground">
                    {row.request_id}
                  </code>
                </DetailRow>
              )}
              <DetailRow label="Retention">
                <span className="text-muted-foreground">
                  Expires {new Date(row.expires_at).toLocaleString()}
                </span>
              </DetailRow>
              {row.audit_metadata && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70 font-medium mb-1">
                    Metadata
                  </p>
                  <pre className="text-[11px] font-mono p-2 rounded bg-black/30 border border-white/[0.05] overflow-x-auto whitespace-pre-wrap break-all max-h-64">
                    {JSON.stringify(row.audit_metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function StatusBadge({ code }: { code: number | null }) {
  if (code == null) return null;
  const ok = code >= 200 && code < 400;
  return (
    <Badge
      variant={ok ? "outline" : "destructive"}
      className={cn(
        "text-[9px] py-0 px-1.5",
        ok ? "text-muted-foreground border-white/10" : "",
      )}
    >
      {code}
    </Badge>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 items-baseline">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground/70 font-medium">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
