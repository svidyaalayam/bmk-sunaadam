import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0023_repair_invalid_talam_patterns"),
    ]

    operations = [
        migrations.CreateModel(
            name="PracticeRecording",
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
                ("owner_key", models.UUIDField()),
                ("exercise_title", models.CharField(max_length=120)),
                (
                    "audio",
                    models.FileField(upload_to="practice-recordings/%Y/%m/"),
                ),
                ("audio_content_type", models.CharField(max_length=100)),
                ("settings", models.JSONField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "exercise",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="practice_recordings",
                        to="lessons.exercise",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [
                    models.Index(
                        fields=["owner_key", "exercise", "-created_at"],
                        name="lessons_pr_owner__037a03_idx",
                    ),
                ],
            },
        ),
    ]
