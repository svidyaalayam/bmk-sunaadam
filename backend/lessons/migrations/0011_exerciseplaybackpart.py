from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0010_playbackstep_repeat_count"),
    ]

    operations = [
        migrations.CreateModel(
            name="ExercisePlaybackPart",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("step_number", models.PositiveIntegerField(default=1)),
                ("position", models.PositiveIntegerField(default=0)),
                ("notes_per_beat", models.PositiveSmallIntegerField(default=1)),
                (
                    "exercise",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="playback_parts",
                        to="lessons.exercise",
                    ),
                ),
                (
                    "section",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to="lessons.exercisesection",
                    ),
                ),
            ],
            options={"ordering": ["step_number", "position", "id"]},
        ),
    ]
