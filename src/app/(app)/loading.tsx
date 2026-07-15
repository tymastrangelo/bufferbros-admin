export default function Loading() {
  return (
    <div className="px-4 md:px-8 py-5 md:py-7 max-w-5xl" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-7 w-36" />
      <div className="skeleton h-4 w-52 mt-2" />
      <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton h-16" />
        ))}
      </div>
      <div className="mt-6 flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-20" />
        ))}
      </div>
    </div>
  );
}
