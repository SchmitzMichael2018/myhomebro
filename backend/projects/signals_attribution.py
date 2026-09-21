import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from projects.models import Agreement, Contractor, Homeowner, Invoice, Project, ProjectStatus
from projects.models_diy_planner import DIYProject
from projects.models_invite import ContractorInvite
from projects.models_proposals import Proposal
from projects.models_referrals import ReferralPayout, ReferralProjectCredit
from projects.services.attribution import add_role, mark_profile_completed, record_event, snapshot_project, snapshot_revenue
from receipts.models import Receipt


log = logging.getLogger(__name__)


def _safe(callback, label, object_id):
    try:
        callback()
    except Exception:
        log.exception("Attribution capture failed for %s=%s", label, object_id)


@receiver(post_save, sender=Contractor)
def contractor_role_attribution(sender, instance, created, **kwargs):
    if created:
        transaction.on_commit(lambda: _safe(lambda: add_role(instance.user, "contractor"), "contractor", instance.pk))
    profile_complete = all(bool(str(getattr(instance, field, "") or "").strip()) for field in (
        "business_name", "phone", "address", "city", "state", "zip",
    ))
    if profile_complete:
        transaction.on_commit(lambda: _safe(
            lambda: mark_profile_completed(instance.user, role="contractor", object_type="contractor", object_id=instance.pk),
            "contractor_profile", instance.pk,
        ))


@receiver(post_save, sender=Homeowner)
def homeowner_role_attribution(sender, instance, created, **kwargs):
    if not created or not instance.email:
        return
    user = get_user_model().objects.filter(email__iexact=instance.email).first()
    if user is None:
        return
    role = "property_manager" if instance.account_type == Homeowner.ACCOUNT_TYPE_PROPERTY_MANAGEMENT_COMPANY else "homeowner"

    def capture():
        mark_profile_completed(user, role=role, object_type="homeowner", object_id=instance.pk)

    transaction.on_commit(lambda: _safe(capture, "homeowner", instance.pk))


@receiver(post_save, sender=Project)
def project_attribution(sender, instance, created, **kwargs):
    if created:
        transaction.on_commit(lambda: _safe(lambda: snapshot_project(instance), "project", instance.pk))
    if instance.status == ProjectStatus.COMPLETED:
        transaction.on_commit(lambda: _safe(
            lambda: record_event("project_completed", project=instance, object_type="project", object_id=instance.pk, idempotency_key=f"project_completed:{instance.pk}"),
            "project_completed", instance.pk,
        ))


@receiver(pre_save, sender=Agreement)
def agreement_attribution_pre_save(sender, instance, **kwargs):
    if not instance.pk:
        instance._attribution_was_signed = False
        instance._attribution_was_funded = False
        return
    previous = sender.objects.filter(pk=instance.pk).values("signed_by_contractor", "signed_by_homeowner", "escrow_funded").first() or {}
    instance._attribution_was_signed = bool(previous.get("signed_by_contractor") and previous.get("signed_by_homeowner"))
    instance._attribution_was_funded = bool(previous.get("escrow_funded"))


@receiver(post_save, sender=Agreement)
def agreement_attribution(sender, instance, created, **kwargs):
    project = instance.project
    if created:
        transaction.on_commit(lambda: _safe(
            lambda: record_event("agreement_created", project=project, object_type="agreement", object_id=instance.pk, idempotency_key=f"agreement_created:{instance.pk}"),
            "agreement", instance.pk,
        ))
    if instance.signature_is_satisfied and not getattr(instance, "_attribution_was_signed", False):
        transaction.on_commit(lambda: _safe(
            lambda: record_event("agreement_signed", project=project, object_type="agreement", object_id=instance.pk, idempotency_key=f"agreement_signed:{instance.pk}"),
            "agreement_signed", instance.pk,
        ))
    if instance.escrow_funded and not getattr(instance, "_attribution_was_funded", False):
        transaction.on_commit(lambda: _safe(
            lambda: record_event("project_funded", project=project, object_type="agreement", object_id=instance.pk, idempotency_key=f"project_funded:project:{project.pk}"),
            "project_funded", instance.pk,
        ))


@receiver(post_save, sender=ContractorInvite)
def contractor_invite_attribution(sender, instance, created, **kwargs):
    if created:
        transaction.on_commit(lambda: _safe(
            lambda: record_event("contractor_invited", object_type="contractor_invite", object_id=instance.pk, idempotency_key=f"contractor_invited:{instance.pk}"),
            "contractor_invite", instance.pk,
        ))


@receiver(post_save, sender=DIYProject)
def diy_project_attribution(sender, instance, created, **kwargs):
    if not created:
        return
    user = get_user_model().objects.filter(email__iexact=instance.owner_email).first()
    transaction.on_commit(lambda: _safe(
        lambda: record_event("diy_project_started", user=user, role="homeowner", object_type="diy_project", object_id=instance.pk,
                             idempotency_key=f"diy_project_started:{instance.pk}"),
        "diy_project", instance.pk,
    ))


@receiver(pre_save, sender=Invoice)
def invoice_attribution_pre_save(sender, instance, **kwargs):
    instance._attribution_was_approved = bool(
        sender.objects.filter(pk=instance.pk, approved_at__isnull=False).exists()
    ) if instance.pk else False


@receiver(post_save, sender=Invoice)
def invoice_attribution(sender, instance, **kwargs):
    if instance.approved_at and not getattr(instance, "_attribution_was_approved", False):
        transaction.on_commit(lambda: _safe(
            lambda: record_event("milestone_approved", project=instance.agreement.project, object_type="invoice", object_id=instance.pk,
                                 idempotency_key=f"milestone_approved:invoice:{instance.pk}"),
            "invoice_approved", instance.pk,
        ))


@receiver(pre_save, sender=Proposal)
def proposal_attribution_pre_save(sender, instance, **kwargs):
    instance._attribution_previous_status = sender.objects.filter(pk=instance.pk).values_list("status", flat=True).first() if instance.pk else None


@receiver(post_save, sender=Proposal)
def proposal_attribution(sender, instance, created, **kwargs):
    if created:
        transaction.on_commit(lambda: _safe(
            lambda: record_event("estimate_created", user=instance.contractor.user, role="contractor", object_type="proposal", object_id=instance.pk, idempotency_key=f"estimate_created:{instance.pk}"),
            "estimate_created", instance.pk,
        ))
    if instance.status == Proposal.STATUS_ACCEPTED and getattr(instance, "_attribution_previous_status", None) != Proposal.STATUS_ACCEPTED:
        transaction.on_commit(lambda: _safe(
            lambda: record_event("estimate_accepted", user=instance.contractor.user, role="contractor", object_type="proposal", object_id=instance.pk, idempotency_key=f"estimate_accepted:{instance.pk}"),
            "estimate_accepted", instance.pk,
        ))


@receiver(post_save, sender=Receipt)
def revenue_attribution(sender, instance, created, **kwargs):
    if created:
        # signals_referrals is imported first; its on-commit callback creates the
        # immutable reward rows before this snapshot reads them.
        transaction.on_commit(lambda: _safe(lambda: snapshot_revenue(Receipt.objects.get(pk=instance.pk)), "receipt", instance.pk))


@receiver(post_save, sender=ReferralPayout)
def referral_payout_attribution(sender, instance, **kwargs):
    if instance.status == ReferralPayout.STATUS_PAID:
        transaction.on_commit(lambda: _safe(
            lambda: record_event("referral_reward_redeemed", user=instance.participant.user, role=instance.participant.primary_role,
                                 object_type="referral_payout", object_id=instance.pk, idempotency_key=f"referral_reward_redeemed:payout:{instance.pk}",
                                 metadata={"amount_cents": instance.amount_cents}),
            "referral_payout", instance.pk,
        ))


@receiver(post_save, sender=ReferralProjectCredit)
def referral_credit_attribution(sender, instance, **kwargs):
    if instance.status == ReferralProjectCredit.STATUS_APPLIED:
        transaction.on_commit(lambda: _safe(
            lambda: record_event("referral_reward_redeemed", user=instance.participant.user, role=instance.participant.primary_role,
                                 project=instance.project, object_type="referral_project_credit", object_id=instance.pk,
                                 idempotency_key=f"referral_reward_redeemed:credit:{instance.pk}", metadata={"amount_cents": instance.amount_cents}),
            "referral_project_credit", instance.pk,
        ))
