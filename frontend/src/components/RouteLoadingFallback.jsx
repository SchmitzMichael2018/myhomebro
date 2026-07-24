import React from "react";
import { LoadingSkeleton } from "./ui/feedback.jsx";

export default function RouteLoadingFallback({ operational = false }) {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-6 lg:px-8">
      <LoadingSkeleton
        variant="workspace"
        theme={operational ? "operational" : "default"}
        label="Loading workspace"
      />
    </div>
  );
}
