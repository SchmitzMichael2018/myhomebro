
# accounts/admin.py
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import AccountSecurityEvent, PhoneVerificationChallenge, User

@admin.register(User)
class CustomUserAdmin(UserAdmin):
    """
    Customizing the admin interface for the custom User model.
    """
    # The fields to be used in displaying the User model.
    list_display = ('email', 'verification_role', 'masked_phone', 'verification_state', 'email_verified_at', 'phone_verified_at', 'trust_classification', 'duplicate_phone_risk', 'acquisition_source', 'referral_source', 'is_active', 'date_joined')
    list_filter = ('verification_state', 'trust_classification', 'duplicate_phone_risk', 'is_staff', 'is_superuser', 'is_active', 'groups')
    actions = ('mark_test', 'mark_suspicious', 'mark_spam_fraud', 'disable_accounts')
    
    # The fields to be used in filtering the User model.
    search_fields = ('email', 'first_name', 'last_name')
    
    # The fields to be used in ordering the User model.
    ordering = ('email',)
    
    # Redefine fieldsets to use email instead of username
    fieldsets = (
        (None, {'fields': ('email', 'password')}),
        ('Personal info', {'fields': ('first_name', 'last_name', 'phone_number', 'phone_number_normalized', 'profile_image')}),
        ('Verification and trust', {'fields': ('verification_state', 'trust_classification', 'email_verified_at', 'phone_verified_at', 'duplicate_phone_risk', 'verification_role', 'verification_continuation', 'acquisition_source', 'referral_source')}),
        ('Permissions', {'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        ('Important dates', {'fields': ('date_joined',)}),
    )
    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('email', 'password', 'password2'),
        }),
    )
    readonly_fields = ('acquisition_source', 'referral_source')

    @admin.display(description='Mobile')
    def masked_phone(self, obj):
        digits = ''.join(ch for ch in (obj.phone_number_normalized or obj.phone_number or '') if ch.isdigit())
        return f'(***) ***-{digits[-4:]}' if len(digits) >= 4 else '—'

    @admin.display(description='Acquisition source')
    def acquisition_source(self, obj):
        try:
            return (obj.acquisition.first_touch or {}).get('source') or '—'
        except Exception:
            return '—'

    @admin.display(description='Referral source')
    def referral_source(self, obj):
        try:
            referral = obj.referral_attribution
            return getattr(referral, 'attributed_code', '') or str(getattr(referral, 'referrer', '') or '—')
        except Exception:
            return '—'

    @admin.action(description='Mark selected accounts as Test')
    def mark_test(self, request, queryset):
        for user in queryset:
            user.trust_classification = User.TrustClassification.TEST
            user.save(update_fields=["trust_classification"])
            AccountSecurityEvent.objects.create(user=user, event_type="account_classified_test", metadata={"admin_user_id": request.user.pk})

    @admin.action(description='Mark selected accounts as Suspicious')
    def mark_suspicious(self, request, queryset):
        for user in queryset:
            user.trust_classification = User.TrustClassification.SUSPICIOUS
            user.verification_state = User.VerificationState.SUSPICIOUS
            user.save(update_fields=["trust_classification", "verification_state"])
            AccountSecurityEvent.objects.create(user=user, event_type="account_classified_suspicious", metadata={"admin_user_id": request.user.pk})

    @admin.action(description='Mark selected accounts as Spam / fraud')
    def mark_spam_fraud(self, request, queryset):
        for user in queryset:
            user.trust_classification = User.TrustClassification.SPAM_FRAUD
            user.is_active = False
            user.save(update_fields=["trust_classification", "is_active"])
            AccountSecurityEvent.objects.create(user=user, event_type="account_classified_spam_fraud", metadata={"admin_user_id": request.user.pk})

    @admin.action(description='Disable selected accounts')
    def disable_accounts(self, request, queryset):
        for user in queryset:
            user.verification_state = User.VerificationState.DISABLED
            user.is_active = False
            user.save(update_fields=["verification_state", "is_active"])
            AccountSecurityEvent.objects.create(user=user, event_type="account_disabled", metadata={"admin_user_id": request.user.pk})


@admin.register(PhoneVerificationChallenge)
class PhoneVerificationChallengeAdmin(admin.ModelAdmin):
    list_display = ('user', 'phone_number_e164', 'sent_at', 'expires_at', 'failed_attempts', 'consumed_at', 'locked_until')
    readonly_fields = ('code_hash', 'sent_at')
    search_fields = ('user__email', 'phone_number_e164')


@admin.register(AccountSecurityEvent)
class AccountSecurityEventAdmin(admin.ModelAdmin):
    list_display = ('event_type', 'user', 'request_ip', 'created_at')
    list_filter = ('event_type', 'created_at')
    search_fields = ('user__email', 'event_type')
    readonly_fields = ('user', 'event_type', 'request_ip', 'metadata', 'created_at')
