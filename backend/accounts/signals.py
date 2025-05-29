from django.db.models.signals import post_save
from django.dispatch import receiver
from django.conf import settings
from django.core.mail import send_mail
from django.urls import reverse
from django.utils.http import urlsafe_base64_encode
from django.utils.encoding import force_bytes  # ✅ Corrected
from django.contrib.auth.tokens import default_token_generator
from django.contrib.auth import get_user_model
from django.apps import apps  # Lazy Model Loading
import logging

User = get_user_model()
logger = logging.getLogger(__name__)

@receiver(post_save, sender=User)
def user_post_save_handler(sender, instance, created, **kwargs):
    """
    Handles user post-save signals:
    - Creates a Contractor profile if user is flagged as a contractor.
    - Sends email verification if the user is not verified.
    """
    if created:
        # ✅ Lazy load Contractor model to avoid circular import
        Contractor = apps.get_model('projects', 'Contractor')
        
        # ✅ Create Contractor profile if flagged as a contractor
        if getattr(instance, 'is_contractor', False):
            Contractor.objects.get_or_create(
                user=instance, 
                name=instance.email, 
                email=instance.email
            )

        # ✅ Send email verification if not verified
        if not instance.is_staff and not getattr(instance, 'is_verified', False):
            try:
                uid = urlsafe_base64_encode(force_bytes(instance.pk))
                token = default_token_generator.make_token(instance)
                verify_url = reverse('verify_email', kwargs={'uidb64': uid, 'token': token})
                full_url = f"{settings.SITE_URL}{verify_url}"
                
                subject = "Verify Your Email - MyHomeBro"
                message = f"Welcome to MyHomeBro! Please verify your email address by clicking the link below:\n{full_url}"
                
                send_mail(
                    subject, 
                    message, 
                    settings.DEFAULT_FROM_EMAIL, 
                    [instance.email], 
                    fail_silently=False
                )
                logger.info(f"Verification email sent to {instance.email} (User ID: {instance.pk})")
            except Exception as e:
                logger.error(f"Failed to send email verification to {instance.email} (User ID: {instance.pk}): {str(e)}")


