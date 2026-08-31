import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import TopBar from "@/components/TopBar";
import AdminPanel from "./AdminPanel";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/auth/dashboard");

  return (
    <div className="min-h-screen">
      <TopBar email={session.email} isAdmin />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <AdminPanel />
      </main>
    </div>
  );
}
