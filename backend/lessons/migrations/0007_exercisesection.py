from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0006_exercise_description"),
    ]

    operations = [
        migrations.CreateModel(
            name="ExerciseSection",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=120)),
                ("notes", models.TextField()),
                ("lyrics", models.TextField(blank=True, default="")),
                ("position", models.PositiveIntegerField(default=0)),
                (
                    "exercise",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="sections",
                        to="lessons.exercise",
                    ),
                ),
            ],
            options={"ordering": ["position", "id"]},
        ),
    ]
