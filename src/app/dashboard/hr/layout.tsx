export default function HRLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-64px)] bg-[#f4f7f8] dark:bg-[#001529] font-sans">
      {children}
    </div>
  );
}
