import django.db.models.deletion
import django.db.models.functions.text
from django.conf import settings
from django.db import migrations, models
from django.db.models import Q


def create_existing_profiles(apps, schema_editor):
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    UserProfile = apps.get_model("lessons", "UserProfile")
    seen_emails = set()

    for user in User.objects.all().order_by("pk").iterator():
        email = (user.email or "").strip().lower()
        profile_email = email if email and email not in seen_emails else None
        if profile_email:
            seen_emails.add(profile_email)
        UserProfile.objects.create(
            user_id=user.pk,
            email=profile_email,
            role="admin" if user.is_superuser else "student",
        )


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0024_practice_recording"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="UserProfile",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("email", models.EmailField(blank=True, max_length=254, null=True)),
                (
                    "role",
                    models.CharField(
                        choices=[
                            ("admin", "Admin"),
                            ("teacher", "Teacher"),
                            ("student", "Student"),
                        ],
                        default="student",
                        max_length=10,
                    ),
                ),
                ("parent_name", models.CharField(blank=True, default="", max_length=150)),
                ("music_teacher_name", models.CharField(blank=True, default="", max_length=150)),
                ("contact_number", models.CharField(blank=True, default="", max_length=40)),
                ("address", models.TextField(blank=True, default="")),
                (
                    "learning_mode",
                    models.CharField(
                        blank=True,
                        choices=[("vocal", "Vocal"), ("instrument", "Instrument")],
                        default="",
                        max_length=12,
                    ),
                ),
                (
                    "user",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="profile",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["user__email", "user__id"],
            },
        ),
        migrations.RunPython(create_existing_profiles, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="userprofile",
            constraint=models.UniqueConstraint(
                django.db.models.functions.text.Lower("email"),
                condition=Q(email__isnull=False),
                name="lessons_profile_email_ci_unique",
            ),
        ),
        migrations.AlterField(
            model_name="practicerecording",
            name="owner_key",
            field=models.UUIDField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="practicerecording",
            name="user",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="practice_recordings",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddIndex(
            model_name="practicerecording",
            index=models.Index(
                fields=["user", "exercise", "-created_at"],
                name="lessons_pr_user_ex_9a8d1c_idx",
            ),
        ),
    ]
