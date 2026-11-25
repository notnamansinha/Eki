import { createRoot } from "react-dom/client";
import HomePage from "@/app/page";
import InstallClient from "@/app/install/InstallClient";
import NotFound from "@/app/not-found";
import AdminLayout from "@/app/admin/layout";
import AdminPage from "@/app/admin/page";
import "../../../frontend/src/app/globals.css";

// One real page per `?surface=`: landing, install, not-found or admin (with `&role=admin`).
const surface = new URLSearchParams(location.search).get("surface");
const page = surface === "landing" ? <HomePage />
  : surface === "install" ? <InstallClient />
  : surface === "not-found" ? <NotFound />
  : surface === "admin" ? <AdminLayout><AdminPage /></AdminLayout>
  : <p>Unknown visual surface</p>;

// The root layout renders pages straight into <body>; a contents-only root keeps that flex frame.
const root = document.createElement("div");
root.style.display = "contents";
document.body.prepend(root);
createRoot(root).render(page);
