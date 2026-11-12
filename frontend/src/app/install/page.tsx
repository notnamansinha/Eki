import type { Metadata } from "next";
import InstallClient from "./InstallClient";
import { publicPageSocialMetadata } from "@/lib/siteMetadata";

const description = "Add Eki to your phone's home screen.";

export const metadata: Metadata = {
  title: "Install Eki",
  description,
  alternates: { canonical: "/install" },
  ...publicPageSocialMetadata({ path: "/install", title: "Install Eki", description }),
};

export default function InstallPage() {
  return <InstallClient />;
}
