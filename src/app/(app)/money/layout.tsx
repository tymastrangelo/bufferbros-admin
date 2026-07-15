import { MoneyTabs } from "./money-tabs";

export default function MoneyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 md:px-8 py-5 md:py-7 max-w-5xl">
      <h1 className="text-xl md:text-2xl font-bold">Money</h1>
      <MoneyTabs />
      {children}
    </div>
  );
}
