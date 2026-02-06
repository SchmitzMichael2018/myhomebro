# Agreements Views Package

This package contains Agreement endpoints (viewset + public endpoints).

## Phase 1
- Keep everything stable by re-exporting:
  - AgreementViewSet
  - public endpoints

## Phase 2
Move code out of legacy into these modules:
- viewset.py
- public.py
- pdf.py
- signing.py
- refunds.py
- address.py
