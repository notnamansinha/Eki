/**
 * Footer link from the public landing page to the public home-screen install
 * guide, so `/install` is discoverable without a shared link (issue #516).
 * A plain anchor keeps the landing page from prefetching the guide's code.
 * The 24px minimum height meets the WCAG 2.2 target-size minimum while keeping
 * the footer on one row at desktop widths.
 */
export default function InstallGuideLink() {
  return (
    <a
      href="/install"
      className="inline-flex min-h-6 items-center text-xs font-bold text-white underline underline-offset-4 drop-shadow-md"
    >
      Install the app
    </a>
  );
}
