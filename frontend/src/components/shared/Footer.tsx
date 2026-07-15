import Link from "next/link";

export default function Footer() {
  return (
    <footer style={{ borderTop: "1px solid var(--border-subtle)" }} className="py-6 px-6 md:px-10">
      <div className="max-w-[1200px] mx-auto flex flex-col md:flex-row justify-between items-center gap-3">
        <span className="label-xs">© 2026 Eki Transit</span>
        <div className="flex gap-6">
          <Link href="/passenger" className="label-xs transition-colors hover:text-[var(--text-secondary)]">
            Passenger View
          </Link>
        </div>
      </div>
    </footer>
  );
}
