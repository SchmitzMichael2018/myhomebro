def extract_card_details_from_payment_intent(pi: dict):
    """
    Returns (brand, last4) best-effort from a Stripe PaymentIntent payload (dict).
    Safe across different payment methods.
    """
    brand = ""
    last4 = ""

    # Most common: charges -> payment_method_details -> card
    try:
        charges = (pi.get("charges") or {}).get("data") or []
        if charges:
            ch = charges[0] or {}
            pmd = ch.get("payment_method_details") or {}
            card = pmd.get("card") or {}
            brand = card.get("brand") or ""
            last4 = card.get("last4") or ""
    except Exception:
        pass

    return brand, last4


def extract_card_details_from_charge(charge: dict):
    """
    Returns (brand, last4) from a Stripe Charge payload (dict).
    """
    brand = ""
    last4 = ""
    try:
        pmd = charge.get("payment_method_details") or {}
        card = pmd.get("card") or {}
        brand = card.get("brand") or ""
        last4 = card.get("last4") or ""
    except Exception:
        pass
    return brand, last4
