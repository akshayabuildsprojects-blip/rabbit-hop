import { useState } from "react";
import { colorOf, type Archetype } from "./lib";

// A rabbit mid-hop, with its hop trail. bg colors the eye so it reads on any background.
export function RabbitIcon({ color = "#000", bg = "#FFE14D", size = 22 }: { color?: string; bg?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <path d="M1.2 21.2c1.2-2.6 2.8-4.3 4.6-5.3" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeDasharray="0.1 2.4" />
      <ellipse cx="11" cy="13.2" rx="5.6" ry="3.7" transform="rotate(-18 11 13.2)" />
      <circle cx="16.9" cy="9" r="2.7" />
      <ellipse cx="15.9" cy="4.3" rx="0.95" ry="2.9" transform="rotate(-22 15.9 4.3)" />
      <ellipse cx="18.2" cy="4.6" rx="0.95" ry="2.7" transform="rotate(12 18.2 4.6)" />
      <circle cx="5.3" cy="12.4" r="1.5" />
      <ellipse cx="7.2" cy="17.1" rx="3.2" ry="1.15" transform="rotate(24 7.2 17.1)" />
      <ellipse cx="16.4" cy="15.2" rx="2.5" ry="0.95" transform="rotate(38 16.4 15.2)" />
      <circle cx="18" cy="8.4" r="0.55" fill={bg} />
    </svg>
  );
}

export function Landing({ archetypes, onLogin }: { archetypes: Archetype[]; onLogin: () => void }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b-2 border-black bg-white">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded border-2 border-black bg-sun">
              <RabbitIcon />
            </span>
            <span className="text-xl font-black tracking-wide">RABBIT HOP</span>
          </div>
          <nav className="flex items-center gap-6 text-[15px] font-semibold">
            <a href="#how" className="underline-offset-4 hover:underline">
              How it works
            </a>
            <button type="button" onClick={onLogin} className="btn btn-ink">
              LOG IN
            </button>
          </nav>
        </div>
      </header>

      <section className="border-b-2 border-black bg-lilac">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-14 px-6 pb-20 pt-16">
          <div className="min-w-0 flex-[1_1_480px]">
            <span className="chip mono">Built on Meta Muse Spark</span>
            <h1 className="mt-5 max-w-[12ch] text-5xl font-black leading-[1.02] tracking-tight sm:text-[64px]">Same catalog. Same budget. Very different carts.</h1>
            <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-ink-2 sm:text-[19px]">
              Rabbit Hop researches how real shopper archetypes behave, locks that evidence into AI shopping agents, and shows you exactly how each one discovers, compares and buys.
            </p>
            <div className="mt-8 flex flex-wrap gap-3.5">
              <button type="button" onClick={onLogin} className="btn btn-sun btn-raised px-6 py-3.5 text-base">
                Start an experiment
              </button>
              <a href="#how" className="btn px-6 py-3.5 text-base">
                See how it works
              </a>
            </div>
          </div>
          <ul className="flex min-w-0 flex-[1_1_380px] flex-col gap-3" aria-label="Shopper archetypes">
            {archetypes.map((a) => (
              <li key={a.persona_id} className="card flex items-center gap-3 px-4 py-3">
                <span className="swatch h-5 w-5" style={{ background: colorOf(a) }} />
                <span className="min-w-0">
                  <span className="block font-extrabold">{a.persona_name}</span>
                  <span className="block truncate text-[13px] text-ink-2">{a.initial_description}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="how" className="mx-auto w-full max-w-[1200px] px-6 pb-16 pt-16">
        <h2 className="text-4xl font-black tracking-tight">How an experiment runs</h2>
        <ol className="mt-7 grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          {[
            ["#FF8FB1", "Research the personas", "Meta Muse Spark searches published consumer research and turns it into a cited behavioral profile you review, edit and lock."],
            ["#3CC7B5", "Agents shop on their own", "Each locked persona shops the same catalog with the same trend feed, mission and budget. Only the persona changes."],
            ["#FFE14D", "Read the report", "Compare journeys, baskets and spend, then see whether a blind judge can tell who shopped from the cart alone."],
          ].map(([bg, title, body], i) => (
            <li key={title} className="box p-6">
              <span className="mono flex h-10 w-10 items-center justify-center rounded border-2 border-black font-semibold" style={{ background: bg }}>
                {i + 1}
              </span>
              <h3 className="mb-1.5 mt-4 text-xl font-extrabold">{title}</h3>
              <p className="text-[15px] leading-relaxed text-ink-2">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-auto border-t-2 border-black px-6 py-5 text-center text-sm text-muted">Rabbit Hop. A Meta Global AI Developer Hackathon project.</footer>
    </div>
  );
}

export function Login({ onLogin, onBack }: { onLogin: (name: string) => void; onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter an email and any password, or use the demo login.");
      return;
    }
    const name = email.split("@")[0].replace(/[._-]+/g, " ").trim();
    onLogin(name ? name[0].toUpperCase() + name.slice(1) : "Guest");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-lilac p-6">
      <div className="w-full max-w-[420px] overflow-hidden rounded-lg border-2 border-black bg-white shadow-[8px_8px_0_#000]">
        <div className="flex items-center gap-2.5 border-b-2 border-black bg-sun px-6 py-4">
          <RabbitIcon />
          <span className="text-lg font-black tracking-wide">RABBIT HOP</span>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4 px-6 pb-6 pt-7" noValidate>
          <div>
            <h1 className="text-3xl font-black">Log in to the lab</h1>
            <p className="mt-1.5 text-sm text-muted">This is a demo. Any email and password work, or skip straight in with the demo login.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-bold">
              Email
            </label>
            <input id="email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="field" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-bold">
              Password
            </label>
            <input id="password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Anything works" className="field" />
          </div>
          {error && (
            <p role="alert" className="text-sm font-semibold">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-ink py-3.5 text-base">
            Log in
          </button>
          <div className="flex items-center gap-3 text-sm font-bold text-muted">
            <span className="h-0.5 flex-1 bg-black" />
            or
            <span className="h-0.5 flex-1 bg-black" />
          </div>
          <button type="button" onClick={() => onLogin("Demo user")} className="btn btn-sun btn-raised py-3.5 text-base">
            Use demo login
          </button>
          <button type="button" onClick={onBack} className="min-h-11 text-sm font-semibold underline">
            Back to home
          </button>
        </form>
      </div>
    </div>
  );
}
