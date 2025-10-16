// frontend/src/components/Step4Review.jsx
// v2025-10-14 footer-only mirror of Step4Finalize (no top buttons, no preview-next-to-sign)

import React from "react";
import Step4Finalize from "./Step4Finalize";

export default function Step4Review(props) {
  // Just reuse the footer-only Step4Finalize.
  // Props include: agreement, id, previewPdf, goPublic, milestones, totals,
  // hasPreviewed, ackReviewed/setAckReviewed, ackTos/setAckTos, ackEsign/setAckEsign,
  // typedName/setTypedName, canSign, signing, signContractor, attachments,
  // defaultWarrantyText, customWarranty, useDefaultWarranty, homeownerDetail, goBack
  return <Step4Finalize {...props} />;
}
