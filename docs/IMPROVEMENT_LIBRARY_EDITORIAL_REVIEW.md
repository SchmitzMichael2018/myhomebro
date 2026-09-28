# Improvement Library editorial review

The three contractor articles introduced in `projects.0328` are **drafts**, not published content. Their copy is adapted from the supplied `MyHomeBro_Contractor_Articles_First_Batch.md` editorial pack. The pack's single-segment suggested URLs were adapted to the existing canonical `/improvements/<category>/<slug>/` route. Numerical claims retain source, population, and time qualifiers. None is a MyHomeBro performance claim.

Staff-only review URLs after this change and its migrations are deployed:

- `/app/admin/improvements/preview/contractor-payment-plan`
- `/app/admin/improvements/preview/contractor-deposit-vs-milestones`
- `/app/admin/improvements/preview/contractor-change-orders`

Manage the drafts at `/app/admin/improvements`. These preview routes require an authenticated staff account. Draft and review-stage articles are not returned from public APIs, public article routes, or the sitemap. An editor must submit, record review, then explicitly publish; an editorial edit returns the article to draft.

In the admin portal, open **Admin Dashboard → Improvement Library** (or use the Improvement Library item in the admin sidebar). Filter the article list by draft, ready for review, published, or archived. Open a draft to edit the problem, evidence/source, Our take, practical steps, action, and metadata; **Save draft** before using **Preview design**. Use **+ New draft** to create another. **Submit for review**, **Record review**, and **Publish reviewed article** are separate actions; unsaved edits block these transitions.

Project Assistant writing help in the editor prepares an outline, narrative draft, or rewrite of a selected narrative section. It uses the current audience, problem, evidence/source, and viewpoint as context, but cannot edit evidence, source links, or numerical claims. A proposal appears in editable review fields and does not enter the article until staff selects **Insert into editor**; inserting still does not save, submit, or publish. Staff should verify all suggested claims and the intended MyHomeBro viewpoint before saving. If AI is unavailable or its output fails safety checks, continue editing manually.

## Claim and source review before publication

- The payment article cites [Intuit QuickBooks' 2025 U.S. small-business survey](https://quickbooks.intuit.com/r/small-business-data/small-business-late-payments-report-2025/), not a contractor-only sample. Its 56% figure concerns businesses reporting unpaid invoices.
- The deposit article cites [FTC disaster-repair consumer guidance](https://consumer.ftc.gov/articles/how-avoid-scams-after-weather-emergencies-and-natural-disasters), not a universal deposit percentage or legal rule.
- The change-order article cites the [2026 U.S. Houzz & Home study](https://www.houzz.com/magazine/2026-u-s-houzz-and-home-study-renovation-trends-stsetivw-vs~185090855). Its 37% figure concerns surveyed homeowners who set initial renovation budgets and exceeded them in 2025; it does not assign blame to contractors.
- Confirm each statement against the current agreement, payment mode, milestone-review, change-order, and dispute workflows. A recorded milestone is not a guarantee of payment. A startup payment is not automatically platform-held. Approval does not bypass release restrictions or an active dispute.
- Check applicable state rules on deposits and contracts before publishing advice that could read as a universal legal rule.
- Confirm the article's CTA lands on the intended live route and keeps the article continuation and approved attribution parameters.
- Review for voice and product terms, then use the admin review action. Publishing remains a distinct action.
