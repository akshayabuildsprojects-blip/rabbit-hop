import { useEffect, useState } from "react";
import { Landing, Login } from "./Public";
import { Dashboard } from "./Dashboard";
import { safeGet, safeSet, type AppConfig } from "./lib";

type Screen = "landing" | "login" | "app";

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [user, setUser] = useState<string | null>(() => safeGet("pcl-user"));
  const [screen, setScreen] = useState<Screen>(() => (safeGet("pcl-user") ? "app" : "landing"));

  useEffect(() => {
    fetch("/api/config")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setConfig)
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  if (loadError)
    return (
      <div className="flex min-h-screen items-center justify-center bg-lilac p-6">
        <div className="card max-w-md p-6">
          <h1 className="text-xl font-black">The lab server is not responding</h1>
          <p className="mt-2 text-ink-2">Start it with npm run dev in the project folder, then reload this page.</p>
        </div>
      </div>
    );
  if (!config) return <p className="p-8 font-semibold text-muted">Loading the lab…</p>;

  if (screen === "landing") return <Landing archetypes={config.archetypes} onLogin={() => setScreen(user ? "app" : "login")} />;
  if (screen === "login")
    return (
      <Login
        onBack={() => setScreen("landing")}
        onLogin={(name) => {
          setUser(name);
          safeSet("pcl-user", name);
          setScreen("app");
        }}
      />
    );
  return (
    <Dashboard
      config={config}
      user={user ?? "Guest"}
      onLogout={() => {
        setUser(null);
        safeSet("pcl-user", null);
        setScreen("landing");
      }}
    />
  );
}
