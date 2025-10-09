// frontend/src/components/ReviewPdfButton.jsx
// v2025-10-09 — Same as PreviewAgreementPdfButton but labeled for “Review”.

import React from "react";
import PreviewAgreementPdfButton from "./PreviewAgreementPdfButton";

export default function ReviewPdfButton(props) {
  return (
    <PreviewAgreementPdfButton
      {...props}
      pingMarkPreviewed={true}
    >
      {props.children || "Review PDF"}
    </PreviewAgreementPdfButton>
  );
}
