"use client";

import { useEffect, useState, useCallback } from "react";

export default function UsersTab() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const fetchUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function handleRevoke(userId: string, email: string) {
    setRevoking(userId);
    setMessage("");
    const res = await fetch("/api/admin/revoke-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      setMessage(`${email} has been logged out on all devices.`);
      fetchUsers();
    } else {
      setMessage("Failed to revoke session.");
    }
    setRevoking(null);
  }

  if (loading) return <p className="text-zinc-500 text-sm">Loading...</p>;

  return (
    <div>
      {message && <p className="text-sm text-accent-400 mb-4">{message}</p>}
      <div className="bg-base-900 border border-base-800 rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-base-800/50 text-zinc-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Email</th>
              <th className="text-left px-4 py-2.5">Role</th>
              <th className="text-left px-4 py-2.5">Joined</th>
              <th className="text-left px-4 py-2.5">Last login</th>
              <th className="text-left px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-base-800">
                <td className="px-4 py-2.5 text-zinc-200">{u.email}</td>
                <td className="px-4 py-2.5">
                  {u.role === "admin" ? (
                    <span className="text-accent-400">Admin</span>
                  ) : (
                    <span className="text-zinc-500">User</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-zinc-500">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5 text-zinc-500">
                  {new Date(u.lastLogin).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => handleRevoke(u.id, u.email)}
                    disabled={revoking === u.id}
                    className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    {revoking === u.id ? "Revoking..." : "Force logout"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-600 mt-3">
        "Force logout" invalidates every session token this user currently has, on every
        device. They'll need to log in again.
      </p>
    </div>
  );
}
