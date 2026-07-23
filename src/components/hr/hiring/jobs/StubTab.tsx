// Placeholder for tabs we haven't built yet. Keeps the page layout
// stable while signalling to HR what's coming.
import { Construction } from "lucide-react";

export default function StubTab({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white p-12 text-center">
      <Construction size={28} className="mx-auto text-slate-300 mb-3" />
      <h3 className="text-[14px] font-semibold text-slate-800">{title}</h3>
      <p className="text-[12px] text-slate-500 mt-1 max-w-md mx-auto">{message}</p>
    </div>
  );
}
