export function getTemplatePricingState({ template, proposal } = {}) {
  const milestones = Array.isArray(template?.milestones) ? template.milestones : [];
  const fixedItems = milestones.filter((item) => Number(item?.suggested_amount_fixed) > 0);
  const allocationItems = milestones.filter((item) => Number(item?.suggested_amount_percent) > 0);
  const selected = Boolean(template?.id && template.id !== "generated");
  const pricingApplied = Boolean(
    selected && proposal?.pricing_template_name && proposal.pricing_template_name === template?.name
  );
  return {
    selected,
    scopeAvailable: selected && milestones.length > 0,
    pricingAvailable: fixedItems.length > 0,
    pricingBasisNeeded: fixedItems.length === 0 && allocationItems.length > 0,
    pricingApplied,
    fixedItems,
    allocationItems,
    status: pricingApplied
      ? "pricing_applied"
      : fixedItems.length
        ? "pricing_available"
        : allocationItems.length
          ? "pricing_basis_needed"
          : selected
            ? "selected"
            : "none",
  };
}

export function buildMilestoneAllocations(template, targetSubtotal) {
  const target = Number(targetSubtotal);
  if (!Number.isFinite(target) || target <= 0) return [];
  return (Array.isArray(template?.milestones) ? template.milestones : [])
    .filter((item) => Number(item?.suggested_amount_percent) > 0)
    .map((item) => {
      const percent = Number(item.suggested_amount_percent);
      const amount = Math.round(target * percent) / 100;
      return {
        milestoneId: item.id,
        title: item.title || "Milestone",
        description: item.description || "",
        percent,
        amount,
      };
    });
}
