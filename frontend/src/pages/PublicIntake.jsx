import { useNavigate } from "react-router-dom";
import PublicIntakeWizard from "../components/intake/PublicIntakeWizard.jsx";
import logo from "../assets/myhomebro_logo.png";

export default function PublicIntake() {
  const navigate = useNavigate();

  return (
    <div
      data-testid="public-intake-shell"
      className="min-h-screen w-full overflow-hidden bg-[linear-gradient(135deg,#020617_0%,#082f63_48%,#0f172a_100%)] text-white"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-300 via-sky-300 to-blue-600" />

      <div className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:py-10">
        <div className="mb-8 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.06] px-4 py-4 shadow-2xl shadow-slate-950/30 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div
            onClick={() => navigate("/")}
            className="flex cursor-pointer items-center gap-3 transition hover:opacity-90"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") navigate("/");
            }}
          >
            <div className="rounded-2xl border border-white/15 bg-white/90 p-2 shadow-lg shadow-slate-950/20">
              <img src={logo} alt="MyHomeBro" className="h-10 w-auto sm:h-11" />
            </div>
            <div>
              <div className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                MyHome<span className="text-amber-300">Bro</span>
              </div>
              <div className="mt-1 text-xs font-semibold uppercase tracking-[0.22em] text-sky-100/70">
                Start a Project
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate("/")}
            className="w-fit rounded-full border border-white/15 bg-slate-950/30 px-4 py-2 text-sm font-semibold text-sky-50 shadow-sm transition hover:border-sky-200/40 hover:bg-sky-400/10 focus:outline-none focus:ring-2 focus:ring-amber-300/50 sm:text-base"
          >
            Back to Home
          </button>
        </div>

        <div className="rounded-[2rem] border border-white/15 bg-white/10 p-2 shadow-2xl shadow-slate-950/35 backdrop-blur">
          <PublicIntakeWizard />
        </div>
      </div>
    </div>
  );
}
