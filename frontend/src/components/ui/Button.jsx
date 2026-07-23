import React from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { cx } from "./designSystemUtils.js";

const variants = {
  primary: "border-blue-600 bg-blue-600 text-white hover:border-blue-700 hover:bg-blue-700",
  secondary: "border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50",
  ghost: "border-transparent bg-transparent text-slate-700 hover:bg-slate-100",
  danger: "border-red-600 bg-red-600 text-white hover:border-red-700 hover:bg-red-700",
  icon: "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50",
  ai: "border-indigo-600 bg-indigo-600 text-white hover:border-indigo-700 hover:bg-indigo-700",
};

const operationalVariants = {
  primary: "border-white/20 bg-white text-[#0a2550] hover:border-white/30 hover:bg-sky-50",
  secondary: "border-white/20 bg-white/10 text-white hover:border-white/30 hover:bg-white/15",
  ghost: "border-transparent bg-transparent text-sky-100 hover:bg-white/10 hover:text-white",
  danger: "border-rose-300/40 bg-rose-400/15 text-rose-100 hover:bg-rose-400/25",
  icon: "border-white/20 bg-white/10 text-sky-100 hover:border-white/30 hover:bg-white/15 hover:text-white",
  ai: "border-indigo-300/35 bg-indigo-400/20 text-indigo-50 hover:bg-indigo-400/30",
};

const sizes = {
  sm: "min-h-8 px-3 py-1.5 text-xs",
  md: "min-h-10 px-4 py-2 text-sm",
  lg: "min-h-12 px-5 py-3 text-base",
};

export const buttonVariants = Object.freeze(Object.keys(variants));

export const Button = React.forwardRef(function Button(
  {
    as: Component = "button",
    type = "button",
    variant = "primary",
    theme = "default",
    size = "md",
    loading = false,
    loadingLabel = "Working...",
    disabled = false,
    icon: Icon,
    iconPosition = "start",
    className = "",
    children,
    ...props
  },
  ref
) {
  const isDisabled = disabled || loading;
  const iconOnly = variant === "icon";
  const sharedProps = Component === "button" ? { type, disabled: isDisabled } : {};

  return (
    <Component
      ref={ref}
      {...sharedProps}
      aria-busy={loading || undefined}
      aria-disabled={Component !== "button" && isDisabled ? true : undefined}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border font-bold",
        "transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-55",
        theme === "operational"
          ? operationalVariants[variant] || operationalVariants.primary
          : variants[variant] || variants.primary,
        theme === "operational" && "focus-visible:ring-sky-300 focus-visible:ring-offset-[#061d42]",
        iconOnly ? "h-10 w-10 p-0" : sizes[size] || sizes.md,
        className
      )}
      {...props}
    >
      {loading ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : Icon && iconPosition === "start" ? (
        <Icon className="h-4 w-4" aria-hidden="true" />
      ) : null}
      {loading ? loadingLabel : children}
      {!loading && Icon && iconPosition === "end" ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
    </Component>
  );
});

export function AIActionButton({ icon = Sparkles, children = "Ask Project Assistant", ...props }) {
  return <Button variant="ai" icon={icon} {...props}>{children}</Button>;
}
