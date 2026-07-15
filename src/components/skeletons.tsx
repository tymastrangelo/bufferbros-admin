// Route skeletons — each mirrors its page's real layout so the swap is seamless.
// They mount inside <main>, so the page-in transition applies to them too.

function Bar({ w, h = 16, className = "" }: { w: number | string; h?: number; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ width: w, height: h }} />;
}

function PageShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`px-4 md:px-8 py-5 md:py-7 ${wide ? "max-w-6xl" : "max-w-5xl"}`} aria-busy="true" aria-label="Loading">
      {children}
    </div>
  );
}

function StatRow({ n }: { n: number }) {
  return (
    <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-px bg-line border border-line rounded-[10px] overflow-hidden">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="bg-card px-3.5 py-3">
          <Bar w={90} h={9} />
          <Bar w={56} h={20} className="mt-2" />
        </div>
      ))}
    </div>
  );
}

export function TodaySkeleton() {
  return (
    <PageShell>
      <Bar w={110} h={26} />
      <Bar w={190} h={14} className="mt-2" />
      <StatRow n={5} />
      <Bar w={130} h={10} className="mt-6" />
      <div className="mt-2 flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="card flex overflow-hidden">
            <div className="w-[74px] shrink-0 px-3 py-3 border-r border-line bg-[#fafbfd]">
              <Bar w={44} h={16} />
              <Bar w={28} h={10} className="mt-1.5" />
            </div>
            <div className="px-3.5 py-3 grow">
              <Bar w="45%" h={16} />
              <Bar w="70%" h={12} className="mt-1.5" />
              <Bar w="55%" h={12} className="mt-1" />
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  );
}

export function CalendarSkeleton() {
  return (
    <PageShell wide>
      <div className="flex items-center gap-2">
        <Bar w={170} h={26} className="mr-auto" />
        <Bar w={120} h={30} />
        <Bar w={150} h={30} />
      </div>
      <div className="card mt-6 overflow-hidden">
        <div className="border-b border-line bg-[#fafbfd] h-8" />
        <div className="grid grid-cols-7">
          {Array.from({ length: 35 }, (_, i) => (
            <div key={i} className={`min-h-[72px] md:min-h-24 p-1.5 border-line ${i % 7 !== 0 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""}`}>
              <Bar w={22} h={22} className="rounded-full!" />
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}

export function CustomersSkeleton() {
  return (
    <PageShell>
      <div className="flex items-center gap-2">
        <Bar w={150} h={26} className="mr-auto" />
        <Bar w={80} h={30} />
        <Bar w={70} h={30} />
      </div>
      <Bar w="100%" h={38} className="mt-4" />
      <div className="mt-3 card divide-y divide-line">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="px-4 py-3">
            <Bar w={`${38 + ((i * 13) % 25)}%`} h={15} />
            <Bar w={`${55 + ((i * 7) % 20)}%`} h={11} className="mt-1.5" />
          </div>
        ))}
      </div>
    </PageShell>
  );
}

export function ProfileSkeleton() {
  return (
    <PageShell>
      <Bar w={140} h={12} />
      <div className="mt-3 flex items-start justify-between">
        <div>
          <Bar w={200} h={26} />
          <Bar w={120} h={14} className="mt-2" />
        </div>
        <Bar w={130} h={30} />
      </div>
      <div className="mt-4 grid grid-cols-4 gap-1.5 max-w-sm">
        {Array.from({ length: 4 }, (_, i) => (
          <Bar key={i} w="100%" h={56} />
        ))}
      </div>
      <div className="mt-5 flex gap-4 border-b border-line pb-2">
        <Bar w={70} h={16} />
        <Bar w={50} h={16} />
        <Bar w={55} h={16} />
      </div>
      <div className="mt-4 card divide-y divide-line">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="px-4 py-3">
            <Bar w={`${40 + ((i * 17) % 30)}%`} h={14} />
          </div>
        ))}
      </div>
    </PageShell>
  );
}

export function PlansSkeleton() {
  return (
    <PageShell>
      <div className="flex items-center gap-2">
        <Bar w={90} h={26} className="mr-auto" />
        <Bar w={150} h={30} />
        <Bar w={100} h={30} />
      </div>
      <div className="mt-4 card overflow-hidden">
        <div className="border-b border-line bg-[#fafbfd] h-8" />
        <div className="divide-y divide-line">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="px-4 py-3.5 flex items-center gap-6">
              <Bar w="22%" h={15} />
              <Bar w="14%" h={13} />
              <Bar w="10%" h={13} />
              <Bar w="16%" h={13} />
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}

export function MoneySkeleton() {
  return (
    <div className="mt-4" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-line border border-line rounded-[10px] overflow-hidden">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="bg-card px-3.5 py-3">
            <Bar w={110} h={9} />
            <Bar w={70} h={20} className="mt-2" />
          </div>
        ))}
      </div>
      <Bar w={170} h={10} className="mt-5" />
      <div className="card mt-2 p-4">
        <div className="flex items-end gap-1.5 h-40">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="skeleton flex-1" style={{ height: `${30 + ((i * 23) % 60)}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="px-4 md:px-8 py-5 md:py-7 max-w-3xl flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <Bar w={110} h={26} />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="card p-5">
          <Bar w={160} h={17} />
          <Bar w="65%" h={12} className="mt-2" />
          <div className="mt-4 flex flex-col gap-2">
            <Bar w="100%" h={34} />
            <Bar w="100%" h={34} />
          </div>
        </div>
      ))}
    </div>
  );
}
