"use client";
import React, { useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Mail, Lock, User, Building2, ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const features = [
  "Hybrid RAG with BM25 + vector search",
  "Cross-encoder re-ranking",
  "PII detection & KMS encryption",
  "7-year immutable audit logs",
  "Automated anomaly detection",
];

export default function SignUpPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 1) { setStep(2); return; }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1400));
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen bg-background flex overflow-hidden">
      {/* Left panel */}
      <motion.div
        initial={{ opacity: 0, x: -30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6 }}
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 border-r border-white/[0.07] relative overflow-hidden"
      >
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "50px 50px",
          }}
        />
        <div className="absolute top-0 left-0 w-96 h-96 bg-fin-500/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 pointer-events-none" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fin-400 to-fin-700 flex items-center justify-center shadow-[0_0_20px_rgba(34,162,105,0.4)]">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-gradient">FinSight AI</span>
        </div>

        <div className="relative z-10">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-3xl font-bold mb-3 leading-tight"
          >
            Institutional-grade AI<br />
            <span className="text-gradient">for financial analysts</span>
          </motion.h2>
          <p className="text-muted-foreground mb-8 leading-relaxed">
            Query 10-Ks, earnings calls, and SEC filings with cited answers, anomaly detection, and full audit trails.
          </p>

          <div className="space-y-3">
            {features.map((f, i) => (
              <motion.div
                key={f}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.1 }}
                className="flex items-center gap-3"
              >
                <div className="w-5 h-5 rounded-full bg-fin-500/20 border border-fin-500/40 flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-fin-400" />
                </div>
                <span className="text-sm text-muted-foreground">{f}</span>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-fin-500/10 border border-fin-500/20">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-fin-400 to-fin-600 flex items-center justify-center text-sm font-bold text-white">JP</div>
            <div>
              <p className="text-sm font-medium">"Replaced 3 hours of analyst work per filing"</p>
              <p className="text-xs text-muted-foreground">— Fixed Income Team, Major Investment Bank</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="gradient-card p-8"
          >
            {/* Step indicator */}
            <div className="flex items-center gap-2 mb-6">
              {[1, 2].map((s) => (
                <React.Fragment key={s}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                    step >= s ? "bg-fin-500 text-white" : "bg-secondary text-muted-foreground"
                  }`}>
                    {step > s ? <Check className="w-3 h-3" /> : s}
                  </div>
                  {s < 2 && <div className={`flex-1 h-0.5 transition-all duration-500 ${step > s ? "bg-fin-500" : "bg-secondary"}`} />}
                </React.Fragment>
              ))}
            </div>

            <h2 className="text-xl font-semibold mb-1">
              {step === 1 ? "Create your account" : "Set up your workspace"}
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {step === 1 ? "Start your 14-day free trial, no credit card required" : "Tell us about your organization"}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {step === 1 ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">First Name</label>
                      <Input placeholder="John" required />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Last Name</label>
                      <Input placeholder="Chen" required />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Work Email</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input type="email" placeholder="j.chen@company.com" className="pl-10" required />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Password</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input type="password" placeholder="Min 12 characters" className="pl-10" required />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Organization</label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input placeholder="JPMorgan Chase & Co." className="pl-10" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Team Size</label>
                    <select className="flex h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-fin-500">
                      <option value="1">Just me</option>
                      <option value="2-10">2–10 analysts</option>
                      <option value="11-50">11–50 analysts</option>
                      <option value="50+">50+ analysts</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Primary Use Case</label>
                    <select className="flex h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-fin-500">
                      <option>SEC Filing Analysis</option>
                      <option>Earnings Call Research</option>
                      <option>M&A Due Diligence</option>
                      <option>Compliance Monitoring</option>
                      <option>Portfolio Research</option>
                    </select>
                  </div>
                </>
              )}

              <Button type="submit" size="lg" variant="glow" className="w-full mt-2" disabled={loading}>
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creating workspace…
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {step === 1 ? "Continue" : "Launch Workspace"}
                    <ArrowRight className="w-4 h-4" />
                  </div>
                )}
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground mt-6">
              Already have an account?{" "}
              <Link href="/sign-in" className="text-fin-400 hover:text-fin-300 font-medium transition-colors">
                Sign in
              </Link>
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
