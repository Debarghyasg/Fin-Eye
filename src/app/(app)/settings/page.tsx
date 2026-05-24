"use client";
import React from "react";
import { motion } from "framer-motion";
import { Shield, Key, Database, Bell, Users, CreditCard, ChevronRight } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const sections = [
  {
    title: "Security & Compliance",
    icon: Shield,
    color: "text-fin-400 bg-fin-500/10",
    items: [
      { label: "PII Auto-Detection", desc: "Scan uploads with AWS Comprehend before storage", enabled: true },
      { label: "KMS Encryption at Rest", desc: "AES-256 via AWS KMS for all document storage", enabled: true },
      { label: "Immutable Audit Logs", desc: "7-year DynamoDB trail — SEC Rule 17a-4 compliant", enabled: true },
      { label: "MFA Required", desc: "Enforce MFA for all workspace members", enabled: false },
    ],
  },
  {
    title: "AI & RAG Pipeline",
    icon: Database,
    color: "text-blue-400 bg-blue-500/10",
    items: [
      { label: "Hybrid Search (BM25 + Vector)", desc: "Combines keyword and semantic retrieval", enabled: true },
      { label: "Cross-Encoder Re-ranking", desc: "Re-score retrieval results before generation", enabled: true },
      { label: "Adaptive Chunking", desc: "Separate strategies for tables vs prose", enabled: true },
      { label: "Multilingual Support", desc: "Auto-translate non-English documents", enabled: false },
    ],
  },
  {
    title: "Notifications",
    icon: Bell,
    color: "text-amber-400 bg-amber-500/10",
    items: [
      { label: "Anomaly Alerts", desc: "Notify when metrics deviate from historical norms", enabled: true },
      { label: "New Filing Processed", desc: "Alert when a document finishes indexing", enabled: true },
      { label: "Sentiment Shifts", desc: "Detect tone changes in management commentary", enabled: false },
      { label: "Weekly Summary Digest", desc: "Email digest every Monday 8 AM EST", enabled: true },
    ],
  },
];

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header title="Settings" subtitle="Workspace configuration and security" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-3xl">
        {sections.map((section, si) => {
          const Icon = section.icon;
          return (
            <motion.div
              key={section.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: si * 0.1 }}
              className="gradient-card p-5"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${section.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold">{section.title}</h3>
              </div>
              <div className="space-y-0">
                {section.items.map((item, ii) => (
                  <motion.div
                    key={item.label}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: si * 0.1 + ii * 0.06 }}
                    className="flex items-center justify-between py-3 border-b border-white/[0.05] last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                    </div>
                    <Switch defaultChecked={item.enabled} />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          );
        })}

        {/* API Keys */}
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
            <h3 className="text-sm font-semibold">API Keys</h3>
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
                <p className="text-[10px] text-muted-foreground">Created {apiKey.created}</p>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10">
                Revoke
              </Button>
            </motion.div>
          ))}
          <Button variant="outline" size="sm" className="mt-3 gap-2 text-xs">
            <Key className="w-3.5 h-3.5" /> Generate New Key
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
