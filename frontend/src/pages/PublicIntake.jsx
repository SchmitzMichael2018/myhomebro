import { useNavigate } from "react-router-dom";
import { CircleHelp, LockKeyhole } from "lucide-react";
import PublicIntakeWizard from "../components/intake/PublicIntakeWizard.jsx";
import logo from "../assets/myhomebro_logo.png";

export default function PublicIntake() {
  const navigate = useNavigate();

  return (
    <div
      data-testid="public-intake-shell"
      className="min-h-screen w-full overflow-hidden bg-[linear-gradient(135deg,#020617_0%,#062856_46%,#0f172a_100%)] text-white"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-300 via-sky-300 to-blue-600" />

      <div className="relative flex min-h-screen flex-col lg:flex-row">
        <aside className="hidden w-[21rem] shrink-0 border-r border-white/10 bg-slate-950/35 px-7 py-8 shadow-2xl shadow-slate-950/30 lg:flex lg:flex-col">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex w-fit items-center gap-3 rounded-2xl text-left transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
          >
            <div className="rounded-xl border border-blue-300/15 bg-blue-950/45 p-1.5 shadow-lg shadow-blue-950/30">
              <img src={logo} alt="MyHomeBro" className="h-11 w-auto" />
            </div>
            <div>
              <div className="text-2xl font-bold tracking-tight text-white">
                MyHome<span className="text-amber-300">Bro</span>
              </div>
            </div>
          </button>

          <div className="mt-12">
            <h1 className="text-3xl font-semibold tracking-tight text-white">Start Your Project</h1>
            <p className="mt-6 text-base font-medium leading-7 text-sky-50">
              Tell us about your project and we&apos;ll help organize it for contractor review.
            </p>
          </div>

          <div className="mt-9 rounded-2xl border border-blue-300/15 bg-blue-950/30 p-6 shadow-xl shadow-blue-950/20">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-300/35 bg-amber-300/10 text-xl text-amber-200">
                <LockKeyhole className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="text-base font-semibold text-white">Secure &amp; Private</div>
            </div>
            <p className="mt-4 text-sm leading-6 text-sky-50/85">
              Your information is encrypted and only shared with contractors you choose.
            </p>
          </div>

          <div className="mt-auto pt-10">
            <div className="rounded-2xl border border-white/10 bg-slate-950/25 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <CircleHelp className="h-4 w-4 text-amber-200" aria-hidden="true" />
                Need help?
              </div>
              <p className="mt-2 text-sm leading-6 text-sky-50/80">
                We&apos;re here to help you every step of the way.
              </p>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-7 lg:py-6">
          <div className="mb-5 rounded-3xl border border-white/10 bg-white/[0.06] px-4 py-4 shadow-2xl shadow-slate-950/30 backdrop-blur lg:hidden">
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
                <img src={logo} alt="MyHomeBro" className="h-10 w-auto" />
              </div>
              <div>
                <div className="text-2xl font-bold tracking-tight text-white">
                  MyHome<span className="text-amber-300">Bro</span>
                </div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-[0.22em] text-sky-100/70">
                  Start Your Project
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm font-medium leading-6 text-sky-50">
              Tell us about your project and we&apos;ll help organize it for contractor review.
            </p>
          </div>

          <PublicIntakeWizard />
        </main>
      </div>
    </div>
  );
}
