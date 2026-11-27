import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from lessons.models import UserProfile


class Command(BaseCommand):
    help = "Create the configured Django admin user if it does not exist."

    def handle(self, *args, **options):
        username = os.environ.get("DJANGO_ADMIN_USERNAME", "admin")
        password = os.environ.get("DJANGO_ADMIN_PASSWORD", "admin")
        email = os.environ.get("DJANGO_ADMIN_EMAIL", "admin@example.com")
        User = get_user_model()

        existing_user = User.objects.filter(username=username).first()
        if existing_user:
            UserProfile.objects.get_or_create(
                user=existing_user,
                defaults={
                    "email": existing_user.email.strip().lower() or None,
                    "role": UserProfile.Role.ADMIN if existing_user.is_superuser else UserProfile.Role.STUDENT,
                },
            )
            return

        User.objects.create_superuser(username=username, email=email, password=password)
        created_user = User.objects.get(username=username)
        UserProfile.objects.create(
            user=created_user,
            email=email.strip().lower() or None,
            role=UserProfile.Role.ADMIN,
        )
        self.stdout.write(self.style.SUCCESS(f"Admin user created: {username}"))
