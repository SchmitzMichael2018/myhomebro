import { useNavigate } from "react-router-dom";
import PublicIntakeWizard from "../components/intake/PublicIntakeWizard.jsx";
import logo from "../assets/myhomebro_logo.png";

export default function PublicIntake() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-blue-900 via-blue-600 to-yellow-400">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div
            onClick={() => navigate("/")}
            className="flex cursor-pointer items-center gap-3 transition hover:opacity-90"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") navigate("/");
            }}
          >
            <img src={logo} alt="MyHomeBro" className="h-10 w-auto drop-shadow-sm" />
            <div className="text-xl font-bold text-white">
              MyHome<span className="text-yellow-300">Bro</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate("/")}
            className="text-sm font-medium text-white/90 underline transition hover:text-white"
          >
            Back to Home
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl bg-white p-6 shadow-xl shadow-black/10">
          <PublicIntakeWizard />
        </div>
      </div>
    </div>
  );
}
