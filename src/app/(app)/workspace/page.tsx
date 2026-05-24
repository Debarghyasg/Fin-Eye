"use client";
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Search, Filter, Grid3X3, List, SlidersHorizontal } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadZone } from "@/components/workspace/UploadZone";
import { DocumentCard } from "@/components/workspace/DocumentCard";
import { QueryPanel } from "@/components/workspace/QueryPanel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

export default function WorkspacePage() {
  const { documents, activeDocId, setActiveDocId } = useAppStore();
  const [search, setSearch] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");

  const filtered = documents.filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.company.toLowerCase().includes(search.toLowerCase()) ||
      d.ticker.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        title="Document Workspace"
        subtitle={`${documents.filter((d) => d.status === "indexed").length} documents indexed · RAG pipeline active`}
      />

      <div className="flex flex-1 min-h-0">
        {/* Left panel — Documents */}
        <div className="w-[380px] flex-shrink-0 border-r border-white/[0.07] flex flex-col">
          {/* Toolbar */}
          <div className="p-4 space-y-3 border-b border-white/[0.07]">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search documents…"
                  className="pl-9 h-8 text-xs"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button
                size="icon-sm"
                variant={view === "grid" ? "secondary" : "ghost"}
                onClick={() => setView("grid")}
              >
                <Grid3X3 className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant={view === "list" ? "secondary" : "ghost"}
                onClick={() => setView("list")}
              >
                <List className="w-3.5 h-3.5" />
              </Button>
            </div>

            <Button
              variant="glow"
              size="sm"
              className="w-full gap-2"
              onClick={() => setShowUpload(!showUpload)}
            >
              <Plus className="w-4 h-4" />
              Upload Documents
            </Button>
          </div>

          {/* Upload zone */}
          <AnimatePresence>
            {showUpload && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden border-b border-white/[0.07]"
              >
                <div className="p-4">
                  <UploadZone />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Document list */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <AnimatePresence>
              {filtered.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-12 text-muted-foreground text-sm"
                >
                  No documents found
                </motion.div>
              ) : (
                filtered.map((doc, i) => (
                  <motion.div
                    key={doc.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <DocumentCard
                      doc={doc}
                      onClick={() => setActiveDocId(doc.id === activeDocId ? null : doc.id)}
                      active={doc.id === activeDocId}
                    />
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right panel — Query */}
        <div className="flex-1 flex flex-col min-w-0">
          <Tabs defaultValue="query" className="flex flex-col h-full">
            <div className="border-b border-white/[0.07] px-4 pt-3">
              <TabsList className="h-8">
                <TabsTrigger value="query" className="text-xs h-7">AI Query</TabsTrigger>
                <TabsTrigger value="preview" className="text-xs h-7">Document Preview</TabsTrigger>
                <TabsTrigger value="extract" className="text-xs h-7">Extracted Data</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="query" className="flex-1 mt-0 min-h-0">
              <QueryPanel />
            </TabsContent>

            <TabsContent value="preview" className="flex-1 mt-0 min-h-0 p-6">
              {activeDocId ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="h-full rounded-xl border border-white/[0.07] bg-card flex items-center justify-center"
                >
                  <div className="text-center">
                    <div className="w-16 h-20 rounded-lg bg-white/[0.04] border border-white/[0.08] mx-auto mb-4 flex items-center justify-center">
                      <span className="text-2xl">📄</span>
                    </div>
                    <p className="font-medium text-sm mb-1">
                      {documents.find((d) => d.id === activeDocId)?.name}
                    </p>
                    <p className="text-xs text-muted-foreground">PDF preview requires react-pdf-viewer</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Install via: npm install @react-pdf-viewer/core</p>
                  </div>
                </motion.div>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  Select a document to preview
                </div>
              )}
            </TabsContent>

            <TabsContent value="extract" className="flex-1 mt-0 min-h-0 overflow-y-auto p-6">
              {activeDocId ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-4"
                >
                  <h3 className="font-semibold text-sm">Extracted Financial Tables</h3>
                  {[
                    { title: "Income Statement", rows: ["Revenue: $383.3B", "Gross Profit: $169.1B", "Net Income: $97.0B", "EPS (diluted): $6.13"] },
                    { title: "Key Metrics", rows: ["Gross Margin: 44.1%", "Operating Margin: 29.8%", "FCF: $99.6B", "ROIC: 56.5%"] },
                  ].map((table) => (
                    <div key={table.title} className="rounded-xl border border-white/[0.07] overflow-hidden">
                      <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/[0.07]">
                        <p className="text-xs font-semibold text-fin-300">{table.title}</p>
                      </div>
                      <div className="p-4 grid grid-cols-2 gap-2">
                        {table.rows.map((row) => {
                          const [label, value] = row.split(": ");
                          return (
                            <div key={row} className="text-xs">
                              <span className="text-muted-foreground">{label}</span>
                              <p className="font-semibold text-foreground">{value}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </motion.div>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  Select a document to view extracted data
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
