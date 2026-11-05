import type { Metadata } from "next";
import InstallClient from "./InstallClient";

export const metadata: Metadata = {
  title: "Install Eki",
  description: "Add Eki to your phone's home screen.",
  alternates: { canonical: "/install" },
};

export default function InstallPage() {
  return <InstallClient />;
}
