import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import TopBar from "@/components/TopBar";
import DashboardFeed from "./DashboardFeed";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/");

  return (
    <div className="min-h-screen">
      <TopBar email={session.email} isAdmin={session.role === "admin"} />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <DashboardFeed />
      </main>
    </div>
  );
}
