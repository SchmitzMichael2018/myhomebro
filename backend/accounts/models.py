# backend/accounts/models.py

from django.db import models
from django.utils import timezone
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin, BaseUserManager, Group, Permission

class CustomUserManager(BaseUserManager):
    """
    Custom manager for the User model where email is the unique identifier.
    """
    def create_user(self, email, password=None, **extra_fields):
        """
        Creates and saves a User with the given email and password.
        """
        if not email:
            raise ValueError("The Email field must be set")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        """
        Creates and saves a superuser with the given email and password.
        """
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)

        if extra_fields.get('is_staff') is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get('is_superuser') is not True:
            raise ValueError("Superuser must have is_superuser=True.")

        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    class VerificationState(models.TextChoices):
        PENDING_EMAIL = "pending_email", "Pending email"
        PENDING_PHONE = "pending_phone", "Pending phone"
        VERIFIED = "verified", "Verified"
        LEGACY_UNVERIFIED = "legacy_unverified", "Legacy unverified"
        SUSPICIOUS = "suspicious", "Suspicious"
        DISABLED = "disabled", "Disabled"

    class TrustClassification(models.TextChoices):
        NORMAL = "normal", "Normal"
        TEST = "test", "Test"
        SUSPICIOUS = "suspicious", "Suspicious"
        SPAM_FRAUD = "spam_fraud", "Spam / fraud"
    """
    Custom User model that uses email for authentication.
    """
    # Set db_index=True on email for faster lookups, as it's the USERNAME_FIELD.
    email = models.EmailField(unique=True, db_index=True)
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    phone_number = models.CharField(max_length=20, blank=True) # Changed from null=True to blank=True for consistency
    profile_image = models.ImageField(upload_to='profile_images/', blank=True, null=True)
    
    # Permissions and status fields
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False) # Staff users can access the admin site.
    is_verified = models.BooleanField(default=False, help_text="Designates whether the user has verified their email address.")
    verification_state = models.CharField(max_length=24, choices=VerificationState.choices, default=VerificationState.LEGACY_UNVERIFIED, db_index=True)
    trust_classification = models.CharField(max_length=20, choices=TrustClassification.choices, default=TrustClassification.NORMAL, db_index=True)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    phone_verified_at = models.DateTimeField(null=True, blank=True)
    phone_number_normalized = models.CharField(max_length=32, blank=True, default="", db_index=True)
    duplicate_phone_risk = models.BooleanField(default=False, db_index=True)
    verification_continuation = models.CharField(max_length=500, blank=True, default="")
    verification_role = models.CharField(max_length=32, blank=True, default="")
    date_joined = models.DateTimeField(default=timezone.now)

    # Custom related_names to avoid clashes with the default User model's relations.
    # This is a correct implementation.
    groups = models.ManyToManyField(
        Group,
        verbose_name='groups',
        blank=True,
        help_text='The groups this user belongs to. A user will get all permissions granted to each of their groups.',
        related_name="custom_user_groups",
        related_query_name="user",
    )
    user_permissions = models.ManyToManyField(
        Permission,
        verbose_name='user permissions',
        blank=True,
        help_text='Specific permissions for this user.',
        related_name="custom_user_permissions",
        related_query_name="user",
    )
    
    # Assign the custom manager.
    objects = CustomUserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['first_name', 'last_name'] # Add fields you want to be prompted for when creating a user via createsuperuser

    def __str__(self):
        """
        Returns the full name if available, otherwise the email.
        More user-friendly in the Django admin.
        """
        if self.first_name and self.last_name:
            return f"{self.first_name} {self.last_name}"
        return self.email

    def get_full_name(self):
        """
        Returns the first_name plus the last_name, with a space in between.
        """
        return f"{self.first_name} {self.last_name}".strip()

    def get_short_name(self):
        """
        Returns the short name for the user.
        """
        return self.first_name

    @property
    def has_full_verification(self):
        return bool(self.email_verified_at and self.phone_verified_at)


class PhoneVerificationChallenge(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="phone_verification_challenges")
    phone_number_e164 = models.CharField(max_length=32, db_index=True)
    code_hash = models.CharField(max_length=255)
    sent_at = models.DateTimeField(default=timezone.now, db_index=True)
    expires_at = models.DateTimeField(db_index=True)
    consumed_at = models.DateTimeField(null=True, blank=True)
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    request_ip = models.GenericIPAddressField(null=True, blank=True)
    session_key = models.CharField(max_length=64, blank=True, default="", db_index=True)


class AccountSecurityEvent(models.Model):
    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="security_events")
    event_type = models.CharField(max_length=64, db_index=True)
    request_ip = models.GenericIPAddressField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
