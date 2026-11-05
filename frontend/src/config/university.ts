/**
 * Ahmedabad University wording and links shown in the passenger panel.
 *
 * TODO(privacy-owner): Communications and the Registrar supply the URLs, the
 * contact and how Eki describes its link to the University. A link stays
 * hidden while its URL is empty; never invent one.
 */
export const UNIVERSITY_LINKS: readonly { label: string; href: string }[] = [
  { label: "Privacy notice", href: "" },
  { label: "Terms of use", href: "" },
  { label: "Accessibility", href: "" },
  { label: "Help & contact (Campus Operations)", href: "" },
];

/** Set by CI; the Profile footer omits whatever is missing. */
export const BUILD_VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION ?? "";
export const BUILD_DATE = process.env.NEXT_PUBLIC_BUILD_DATE ?? "";
