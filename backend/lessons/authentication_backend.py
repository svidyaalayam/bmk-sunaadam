from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend

from .models import UserProfile


class EmailAuthenticationBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        email = kwargs.get("email", username)
        if not email or not password:
            return None

        profile = (
            UserProfile.objects.select_related("user")
            .filter(email__iexact=email)
            .first()
        )
        if profile:
            user = profile.user
            if user.check_password(password) and self.user_can_authenticate(user):
                return user
            return None

        User = get_user_model()
        return super().authenticate(request, username=username, password=password, **kwargs)
