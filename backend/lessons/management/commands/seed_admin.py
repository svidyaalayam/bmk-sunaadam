import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Create the configured Django admin user if it does not exist."

    def handle(self, *args, **options):
        username = os.environ.get("DJANGO_ADMIN_USERNAME", "admin")
        password = os.environ.get("DJANGO_ADMIN_PASSWORD", "admin")
        email = os.environ.get("DJANGO_ADMIN_EMAIL", "admin@example.com")
        User = get_user_model()

        if User.objects.filter(username=username).exists():
            return

        User.objects.create_superuser(username=username, email=email, password=password)
        self.stdout.write(self.style.SUCCESS(f"Admin user created: {username}"))
