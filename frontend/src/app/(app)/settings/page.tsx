"use client";
import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Shield, Key, Database, Bell, ChevronRight,
  User as UserIcon, Briefcase, Plus, CheckCircle2, AlertCircle, Loader2,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IS_LIVE_API,
  ApiError,
  getMe,
  updateMe,
  listMyWorkspaces,
  createWorkspace,
  type UserOut,
  type WorkspaceOut,
} from "@/lib/api";
import { cn, formatNumber } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

/* ─────────────────────────────────────────────────────────────────────────────
 * Static config sections — preserved from the original mock dashboard.
 * These switches don't persist anywhere yet; they're a placeholder UI for
 * security/AI/notification toggles that the backend will own later.
 * Labels/descriptions are translation keys resolved at render time.
 * ────────────────────────────────────────────────────────────────────────── */
const sections = [
  {
    titleKey: "settings.secCompliance",
    icon: Shield,
    color: "text-fin-400 bg-fin-500/10",
    items: [
      { labelKey: "settings.piiTitle", descKey: "settings.piiDesc", enabled: true },
      { labelKey: "settings.kmsTitle", descKey: "settings.kmsDesc", enabled: true },
      { labelKey: "settings.immutableTitle", descKey: "settings.immutableDesc", enabled: true },
      { labelKey: "settings.mfaTitle", descKey: "settings.mfaDesc", enabled: false },
    ],
  },
  {
    titleKey: "settings.aiPipeline",
    icon: Database,
    color: "text-blue-400 bg-blue-500/10",
    items: [
      { labelKey: "settings.hybridTitle", descKey: "settings.hybridDesc", enabled: true },
      { labelKey: "settings.crossEncoderTitle", descKey: "settings.crossEncoderDesc", enabled: true },
      { labelKey: "settings.adaptiveTitle", descKey: "settings.adaptiveDesc", enabled: true },
      { labelKey: "settings.multilingualTitle", descKey: "settings.multilingualDesc", enabled: false },
    ],
  },
  {
    titleKey: "settings.notifications",
    icon: Bell,
    color: "text-amber-400 bg-amber-500/10",
    items: [
      { labelKey: "settings.anomalyTitle", descKey: "settings.anomalyDesc", enabled: true },
      { labelKey: "settings.newFilingTitle", descKey: "settings.newFilingDesc", enabled: true },
      { labelKey: "settings.sentimentTitle", descKey: "settings.sentimentDesc", enabled: false },
      { labelKey: "settings.weeklyTitle", descKey: "settings.weeklyDesc", enabled: true },
    ],
  },
];

/* ─────────────────────────────────────────────────────────────────────────────
 * Profile section — wired to GET / PATCH /auth/me.
 * ────────────────────────────────────────────────────────────────────────── */
function ProfileCard() {
  const { getToken, isSignedIn } = useAuth();
  const { t } = useTranslation();
  const liveEnabled = IS_LIVE_API && Boolean(isSignedIn);

  const meQuery = useQuery<UserOut>({
    queryKey: ["me"],
    queryFn: () => getMe(getToken),
    enabled: liveEnabled,
    staleTime: 60_000,
  });

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Hydrate the form whenever the server response lands.
  useEffect(() => {
    if (meQuery.data) {
      setFullName(meQuery.data.full_name ?? "");
      setEmail(meQuery.data.email ?? "");
    }
  }, [meQuery.data]);

  const queryClient = useQueryClient();
  const saveMutation = useMutation({
    mutationFn: () =>
      updateMe(
        {
          // Only send fields that actually changed; the backend treats
          // missing fields as "don't touch".
          full_name: fullName !== (meQuery.data?.full_name ?? "") ? fullName : undefined,
          email:     email     !== (meQuery.data?.email ?? "")     ? email     : undefined,
        },
        getToken,
      ),
    onSuccess: (next) => {
      queryClient.setQueryData(["me"], next);
      setFeedback({ kind: "ok", text: t("settings.profileUpdated") });
    },
    onError: (err: unknown) => {
      const text =
        err instanceof ApiError
          ? `${t("settings.updateFailedPrefix")} ${err.message}`
          : t("settings.updateFailed");
      setFeedback({ kind: "err", text });
    },
  });

  const isDirty =
    !!meQuery.data &&
    (fullName !== (meQuery.data.full_name ?? "") ||
      email !== (meQuery.data.email ?? ""));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="gradient-card p-5"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500/10 text-blue-400">
          <UserIcon className="w-4 h-4" />
        </div>
        <h3 className="text-sm font-semibold">{t("settings.profile")}</h3>
        {liveEnabled && meQuery.isFetching && (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        )}
      </div>

      {!liveEnabled && (
        <p className="text-xs text-muted-foreground">
          {t("settings.profileSignInPrefix")} <code className="text-fin-300">NEXT_PUBLIC_API_URL</code> {t("settings.profileSignInSuffix")}
        </p>
      )}

      {liveEnabled && meQuery.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {liveEnabled && meQuery.isError && (
        <ProfileError detail={(meQuery.error as Error)?.message} />
      )}

      {liveEnabled && meQuery.data && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setFeedback(null);
            saveMutation.mutate();
          }}
        >
          <FieldRow label={t("settings.displayName")}>
            <Input
              value={fullName}
              maxLength={255}
              placeholder="Jane Doe"
              onChange={(e) => setFullName(e.target.value)}
              className="h-9 text-xs"
            />
          </FieldRow>

          <FieldRow label={t("settings.email")}>
            <Input
              type="email"
              value={email}
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 text-xs"
            />
          </FieldRow>

          <FieldRow label={t("settings.clerkUserId")} muted>
            <code className="text-[11px] text-muted-foreground font-mono break-all">
              {meQuery.data.clerk_user_id}
            </code>
          </FieldRow>

          <FieldRow label={t("settings.accountCreated")} muted>
            <span className="text-xs text-muted-foreground">
              {new Date(meQuery.data.created_at).toLocaleString()}
            </span>
          </FieldRow>

          <div className="flex items-center justify-between pt-2 border-t border-white/[0.05]">
            <FeedbackLine feedback={feedback} />
            <Button
              type="submit"
              size="sm"
              disabled={!isDirty || saveMutation.isPending}
              className="text-xs"
            >
              {saveMutation.isPending ? t("settings.saving") : t("settings.saveChanges")}
            </Button>
          </div>
        </form>
      )}
    </motion.div>
  );
}

function ProfileError({ detail }: { detail?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 py-3 px-3 rounded-lg bg-red-500/5 border border-red-500/20 text-xs">
      <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
      <div>
        <p className="font-medium text-red-300">{t("settings.couldNotLoadProfile")}</p>
        <p className="text-muted-foreground">{detail ?? t("common.backendUnavailable")}</p>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  children,
  muted,
}: {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 items-center">
      <span
        className={cn(
          "text-[11px] uppercase tracking-wide font-medium",
          muted ? "text-muted-foreground/70" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

function FeedbackLine({ feedback }: { feedback: { kind: "ok" | "err"; text: string } | null }) {
  if (!feedback) return <span className="text-[11px] text-muted-foreground/70">—</span>;
  if (feedback.kind === "ok") {
    return (
      <span className="flex items-center gap-1 text-[11px] text-emerald-400">
        <CheckCircle2 className="w-3 h-3" /> {feedback.text}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] text-red-400">
      <AlertCircle className="w-3 h-3" /> {feedback.text}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Workspaces section — wired to GET / POST /auth/me/workspaces.
 * ────────────────────────────────────────────────────────────────────────── */
function WorkspacesCard() {
  const { getToken, isSignedIn } = useAuth();
  const { t } = useTranslation();
  const liveEnabled = IS_LIVE_API && Boolean(isSignedIn);
  const queryClient = useQueryClient();

  const wsQuery = useQuery<WorkspaceOut[]>({
    queryKey: ["my-workspaces"],
    queryFn: () => listMyWorkspaces(getToken),
    enabled: liveEnabled,
  });

  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      createWorkspace(
        {
          name: newName.trim(),
          description: newDescription.trim() || undefined,
        },
        getToken,
      ),
    onSuccess: (workspace) => {
      // Optimistic merge — also bump the cache the workspace switcher reads.
      queryClient.setQueryData<WorkspaceOut[] | undefined>(
        ["my-workspaces"],
        (prev) => (prev ? [...prev, workspace] : [workspace]),
      );
      setNewName("");
      setNewDescription("");
      setCreateError(null);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setCreateError(err.message);
      } else {
        setCreateError((err as Error)?.message ?? t("settings.failedCreateWorkspace"));
      }
    },
  });

  const canSubmit = newName.trim().length > 0 && !createMutation.isPending;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="gradient-card p-5"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-fin-500/10 text-fin-400">
          <Briefcase className="w-4 h-4" />
        </div>
        <h3 className="text-sm font-semibold">{t("settings.workspaces")}</h3>
        {liveEnabled && wsQuery.isFetching && (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        )}
        <Badge variant="outline" className="ml-auto text-[10px] py-0 px-1.5">
          {liveEnabled && wsQuery.data ? wsQuery.data.length : "—"} {t("settings.totalSuffix")}
        </Badge>
      </div>

      {!liveEnabled && (
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.connectBackendWorkspaces")}
        </p>
      )}

      {liveEnabled && wsQuery.isLoading && (
        <div className="space-y-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      )}

      {liveEnabled && wsQuery.isError && (
        <div className="flex items-start gap-2 py-3 px-3 rounded-lg bg-red-500/5 border border-red-500/20 text-xs mb-3">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-300">{t("settings.couldNotLoadWorkspaces")}</p>
            <p className="text-muted-foreground">
              {(wsQuery.error as Error)?.message ?? t("common.backendUnavailable")}
            </p>
          </div>
        </div>
      )}

      {liveEnabled && wsQuery.data && (
        <div className="space-y-2 mb-4">
          {wsQuery.data.length === 0 && (
            <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-white/10 rounded-lg">
              {t("settings.noWorkspaces")}
            </p>
          )}
          {wsQuery.data.map((ws, i) => (
            <motion.div
              key={ws.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-white/[0.02] border border-white/[0.05]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{ws.name}</span>
                  {ws.is_default && (
                    <Badge variant="success" className="text-[9px] py-0 px-1.5">
                      {t("settings.default")}
                    </Badge>
                  )}
                </div>
                {ws.description && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {ws.description}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                  {formatNumber(ws.document_count)} {t("settings.documentsWord")} · {t("settings.createdWord")}{" "}
                  {new Date(ws.created_at).toLocaleDateString()}
                </p>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            </motion.div>
          ))}
        </div>
      )}

      {liveEnabled && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            setCreateError(null);
            createMutation.mutate();
          }}
          className="space-y-2 pt-3 border-t border-white/[0.05]"
        >
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
            {t("settings.newWorkspace")}
          </p>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("settings.workspaceNamePlaceholder")}
            maxLength={255}
            className="h-9 text-xs"
          />
          <Input
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder={t("settings.descriptionPlaceholder")}
            maxLength={1024}
            className="h-9 text-xs"
          />
          <div className="flex items-center justify-between gap-3">
            {createError ? (
              <span className="flex items-center gap-1 text-[11px] text-red-400">
                <AlertCircle className="w-3 h-3" /> {createError}
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground/70">
                {t("settings.namesUnique")}
              </span>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={!canSubmit}
              className="text-xs gap-1.5"
            >
              <Plus className="w-3 h-3" />
              {createMutation.isPending ? t("settings.creating") : t("settings.create")}
            </Button>
          </div>
        </form>
      )}
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Page entry-point.
 * ────────────────────────────────────────────────────────────────────────── */
export default function SettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-3xl">

        <ProfileCard />
        <WorkspacesCard />

        {sections.map((section, si) => {
          const Icon = section.icon;
          return (
            <motion.div
              key={section.titleKey}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: si * 0.1 }}
              className="gradient-card p-5"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${section.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold">{t(section.titleKey)}</h3>
              </div>
              <div className="space-y-0">
                {section.items.map((item, ii) => (
                  <motion.div
                    key={item.labelKey}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: si * 0.1 + ii * 0.06 }}
                    className="flex items-center justify-between py-3 border-b border-white/[0.05] last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium">{t(item.labelKey)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{t(item.descKey)}</p>
                    </div>
                    <Switch defaultChecked={item.enabled} />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          );
        })}

        {/* API Keys (still mock — backend has no API-key model yet) */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="gradient-card p-5"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-violet-500/10 text-violet-400">
              <Key className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold">{t("settings.apiKeys")}</h3>
          </div>
          {[
            { name: "Production Key", key: "fsk_prod_••••••••••••••••3f2a", created: "Jan 12, 2024", scopes: ["read", "query"] },
            { name: "CI/CD Key", key: "fsk_ci_••••••••••••••••9c1b", created: "Mar 3, 2024", scopes: ["read"] },
          ].map((apiKey, i) => (
            <motion.div
              key={apiKey.name}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 + i * 0.08 }}
              className="flex items-center justify-between py-3 border-b border-white/[0.05] last:border-0"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{apiKey.name}</p>
                  {apiKey.scopes.map((s) => (
                    <Badge key={s} variant="outline" className="text-[9px] py-0 px-1.5">{s}</Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">{apiKey.key}</p>
                <p className="text-[10px] text-muted-foreground">{t("settings.createdLabel")} {apiKey.created}</p>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10">
                {t("settings.revoke")}
              </Button>
            </motion.div>
          ))}
          <Button variant="outline" size="sm" className="mt-3 gap-2 text-xs">
            <Key className="w-3.5 h-3.5" /> {t("settings.generateNewKey")}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
