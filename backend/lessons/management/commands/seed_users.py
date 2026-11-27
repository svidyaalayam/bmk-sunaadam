import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from lessons.models import UserProfile


class Command(BaseCommand):
    help = "Create the default admin, teacher, and student accounts if needed."

    def handle(self, *args, **options):
        User = get_user_model()
        users = (
            {
                "username": os.environ.get("DJANGO_ADMIN_USERNAME", "admin"),
                "email": os.environ.get("DJANGO_ADMIN_EMAIL", "admin@example.com"),
                "password": os.environ.get("DJANGO_ADMIN_PASSWORD", "admin"),
                "role": UserProfile.Role.ADMIN,
                "superuser": True,
            },
            {
                "username": "teacher@example.com",
                "email": "teacher@example.com",
                "password": os.environ.get("DJANGO_TEACHER_PASSWORD", "teacher"),
                "role": UserProfile.Role.TEACHER,
                "superuser": False,
            },
            {
                "username": "student@example.com",
                "email": "student@example.com",
                "password": os.environ.get("DJANGO_STUDENT_PASSWORD", "student"),
                "role": UserProfile.Role.STUDENT,
                "superuser": False,
            },
        )

        with transaction.atomic():
            for account in users:
                user = User.objects.filter(username=account["username"]).first()
                if user is None:
                    existing_profile = UserProfile.objects.filter(
                        email__iexact=account["email"],
                    ).select_related("user").first()
                    user = existing_profile.user if existing_profile else None

                if user is None:
                    if account["superuser"]:
                        user = User.objects.create_superuser(
                            username=account["username"],
                            email=account["email"],
                            password=account["password"],
                        )
                    else:
                        user = User.objects.create_user(
                            username=account["username"],
                            email=account["email"],
                            password=account["password"],
                        )
                    self.stdout.write(self.style.SUCCESS(f"Created {account['role']} account: {account['email']}"))

                profile, _ = UserProfile.objects.get_or_create(user=user)
                profile.email = account["email"]
                profile.role = account["role"]
                profile.save()
