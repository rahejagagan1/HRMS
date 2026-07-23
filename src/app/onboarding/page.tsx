"use client";

// First-login wizard. Anyone with onboardingPending=true on their User row
// is bounced here by LayoutShell until they complete this minimal form.
// Keeps the surface area tiny on purpose — phone, address, emergency
// contact. Anything more elaborate lives in /dashboard/hr/profile.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  CheckCircle2, Phone, MapPin, ShieldAlert, ArrowRight, Sparkles,
  AlertCircle,
} from "lucide-react";

const inputCls =
  "w-full h-11 px-3.5 bg-white border border-slate-200 rounded-lg text-[13.5px] text-slate-800 placeholder-slate-400 transition-colors focus:outline-none focus:border-[#0f6ecd] focus:ring-2 focus:ring-[#0f6ecd]/15";
const labelCls =
  "block text-[10.5px] font-semibold text-slate-500 uppercase tracking-[0.12em] mb-1.5";

function SectionTitle({
  icon: Icon, title, hint,
}: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0f6ecd]/10 text-[#0f6ecd]">
        <Icon size={16} />
      </div>
      <div>
        <h3 className="text-[14px] font-semibold text-slate-800 leading-tight">{title}</h3>
        <p className="text-[12px] text-slate-500 mt-0.5">{hint}</p>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session, status, update } = useSession();
  const [form, setForm] = useState({
    phone: "",
    address: "",
    city: "",
    state: "",
    emergencyPhone: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Once their flag is cleared (e.g. they finished and we re-rendered),
  // bounce them onward. Belt-and-braces in case the redirect-after-submit
  // didn't take.
  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    } else if (
      status === "authenticated" &&
      (session?.user as any)?.onboardingPending === false
    ) {
      router.replace("/dashboard/hr/home");
    }
  }, [status, session, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not save onboarding");
      await update();
      router.replace("/dashboard/hr/home");
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const firstName = session?.user?.name?.split(" ")[0] ?? "";

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#eef4fb] via-[#f4f7fb] to-[#f1f5f9] py-12 px-4">
      <div className="mx-auto w-full max-w-3xl">
        {/* Tagline above the card */}
        <div className="text-center mb-5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0f6ecd] ring-1 ring-[#0f6ecd]/15 shadow-sm">
            <Sparkles size={11} />
            NB Media · First-time setup
          </span>
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-[0_8px_30px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/60">
          {/* ── Hero header — deep gradient, decorative blobs, big white welcome ── */}
          <div className="relative overflow-hidden bg-gradient-to-br from-[#0a4f9f] via-[#0f6ecd] to-[#1f8be5] px-8 py-10 sm:px-10 sm:py-12">
            {/* soft decorative gloss */}
            <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
            <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-white/10 blur-3xl" />

            <div className="relative">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
                Welcome aboard
              </p>
              <h1 className="mt-2 text-[26px] sm:text-[30px] font-bold leading-tight text-white">
                Hi{firstName ? `, ${firstName}` : ""} — let's get you set up.
              </h1>
              <p className="mt-3 max-w-xl text-[13.5px] sm:text-[14px] text-white/90 leading-relaxed">
                A few quick details before you head into your dashboard. Everything
                here can be edited later from your profile, so don't sweat the small stuff.
              </p>

              {/* Progress chip — non-interactive, signals "almost there" */}
              <div className="mt-6 flex items-center gap-2 text-[11.5px] font-semibold text-white/85">
                <span className="inline-flex h-1.5 w-12 rounded-full bg-white/90" />
                <span className="inline-flex h-1.5 w-12 rounded-full bg-white/40" />
                <span className="ml-1 uppercase tracking-[0.14em] text-white/80">Step 1 of 1 · ~30 seconds</span>
              </div>
            </div>
          </div>

          {/* ── Form body ── */}
          <form onSubmit={onSubmit} className="px-7 py-8 sm:px-10 space-y-8">
            {/* Contact */}
            <section>
              <SectionTitle icon={Phone} title="Contact" hint="The mobile number where HR can reach you." />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className={labelCls}>Mobile number</label>
                  <input
                    className={inputCls}
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    placeholder="+91 98xxxxxxxx"
                    type="tel"
                    required
                  />
                </div>
              </div>
            </section>

            {/* Address */}
            <section>
              <SectionTitle icon={MapPin} title="Where you live" hint="Used for HR records and benefits paperwork." />
              <div className="space-y-5">
                <div>
                  <label className={labelCls}>Address</label>
                  <input
                    className={inputCls}
                    value={form.address}
                    onChange={(e) => set("address", e.target.value)}
                    placeholder="House / street"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className={labelCls}>City</label>
                    <input
                      className={inputCls}
                      value={form.city}
                      onChange={(e) => set("city", e.target.value)}
                      placeholder="e.g. Mohali"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>State</label>
                    <input
                      className={inputCls}
                      value={form.state}
                      onChange={(e) => set("state", e.target.value)}
                      placeholder="e.g. Punjab"
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* Emergency contact */}
            <section>
              <SectionTitle
                icon={ShieldAlert}
                title="Emergency contact"
                hint="Someone we can reach if anything urgent comes up."
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className={labelCls}>Contact number</label>
                  <input
                    className={inputCls}
                    value={form.emergencyPhone}
                    onChange={(e) => set("emergencyPhone", e.target.value)}
                    placeholder="+91 98xxxxxxxx"
                    type="tel"
                  />
                </div>
              </div>
            </section>

            {error && (
              <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-[12.5px] px-3.5 py-2.5 rounded-lg">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit row — separate visual area from the form */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-slate-100">
              <p className="text-[12px] text-slate-500">
                <CheckCircle2 className="inline-block h-3.5 w-3.5 -mt-0.5 mr-1 text-emerald-500" />
                You can update any of this later from
                <span className="font-semibold text-slate-700"> Profile</span>.
              </p>
              <button
                type="submit"
                disabled={saving}
                className="group inline-flex items-center justify-center gap-2 bg-gradient-to-r from-[#0a4f9f] to-[#0f6ecd] hover:from-[#0a4690] hover:to-[#0d63bb] disabled:opacity-60 disabled:cursor-not-allowed text-white text-[13.5px] font-semibold px-6 h-11 rounded-lg shadow-sm shadow-[#0f6ecd]/20 transition-all"
              >
                {saving ? "Saving…" : "Finish & open dashboard"}
                <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </form>
        </div>

        <p className="text-center mt-5 text-[11.5px] text-slate-400">
          Need help? Reach out to HR — we'll fix it up for you.
        </p>
      </div>
    </div>
  );
}
