from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0007_exercisesection"),
    ]

    operations = [
        migrations.CreateModel(
            name="ExercisePlaybackStep",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("notes_per_beat", models.PositiveSmallIntegerField(default=1)),
                ("position", models.PositiveIntegerField(default=0)),
                (
                    "exercise",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="playback_sequence",
                        to="lessons.exercise",
                    ),
                ),
                (
                    "section",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="playback_steps",
                        to="lessons.exercisesection",
                    ),
                ),
            ],
            options={"ordering": ["position", "id"]},
        ),
    ]
