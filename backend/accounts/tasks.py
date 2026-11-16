from celery import shared_task

from accounts.services.welcome import deliver_welcome
from accounts.services.signup_alerts import deliver_signup_alert


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_admin_signup_sms(self, delivery_id):
    status = deliver_signup_alert(delivery_id)
    if status == "failed":
        raise self.retry(exc=RuntimeError("Signup SMS delivery failed"))
    return status


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_contractor_welcome(self, delivery_id):
    try:
        return deliver_welcome(delivery_id)
    except Exception as exc:
        # Avoid persisting mail-provider exception details in task results/logs.
        raise self.retry(exc=RuntimeError("Welcome email delivery failed")) from None
