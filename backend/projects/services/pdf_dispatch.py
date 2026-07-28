from __future__ import annotations

import logging
from dataclasses import dataclass
from urllib.parse import urlparse

from django.conf import settings
from django.utils import timezone

from projects.models import Agreement

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PDFDispatchResult:
    accepted: bool
    status: str
    task_id: str = ""
    error_code: str = ""


def _broker_host() -> str:
    try:
        return urlparse(str(getattr(settings, "CELERY_BROKER_URL", ""))).hostname or "unconfigured"
    except ValueError:
        return "invalid"


def set_pdf_generation_status(
    agreement_id: int,
    status: str,
    *,
    task_id: str | None = None,
    error_code: str = "",
    only_from: tuple[str, ...] | None = None,
) -> bool:
    queryset = Agreement.objects.filter(pk=agreement_id)
    if only_from:
        queryset = queryset.filter(pdf_generation_status__in=only_from)
    updates = {
        "pdf_generation_status": status,
        "pdf_generation_error_code": error_code[:80],
        "pdf_generation_updated_at": timezone.now(),
    }
    if task_id is not None:
        updates["pdf_task_id"] = task_id
    return bool(queryset.update(**updates))


def enqueue_agreement_pdf(agreement_id: int) -> PDFDispatchResult:
    queue = str(getattr(settings, "PDF_QUEUE_NAME", "pdf"))
    logger.info(
        "pdf_enqueue_attempt document_type=agreement record_id=%s queue=%s broker_host=%s",
        agreement_id,
        queue,
        _broker_host(),
    )
    if not getattr(settings, "PDF_ASYNC_ENABLED", False):
        set_pdf_generation_status(
            agreement_id,
            "disabled",
            task_id="",
            error_code="",
        )
        logger.info(
            "pdf_enqueue_skipped document_type=agreement record_id=%s "
            "queue=%s reason=async_pdf_disabled",
            agreement_id,
            queue,
        )
        return PDFDispatchResult(False, "disabled")

    try:
        from projects.tasks import task_generate_full_agreement_pdf

        result = task_generate_full_agreement_pdf.apply_async(
            args=[agreement_id],
            queue=queue,
        )
    except Exception as exc:
        error_code = f"enqueue_{type(exc).__name__}".lower()
        set_pdf_generation_status(
            agreement_id,
            "failed_retryable",
            task_id="",
            error_code=error_code,
        )
        logger.error(
            "pdf_enqueue_failure document_type=agreement record_id=%s "
            "queue=%s broker_host=%s error_code=%s",
            agreement_id,
            queue,
            _broker_host(),
            error_code,
        )
        return PDFDispatchResult(False, "failed_retryable", error_code=error_code)

    task_id = str(result.id or "")
    set_pdf_generation_status(
        agreement_id,
        "queued",
        task_id=task_id,
        error_code="",
        only_from=("pending", "failed_retryable"),
    )
    logger.info(
        "pdf_enqueue_success document_type=agreement record_id=%s "
        "task_id=%s queue=%s broker_host=%s",
        agreement_id,
        task_id,
        queue,
        _broker_host(),
    )
    return PDFDispatchResult(True, "queued", task_id=task_id)
