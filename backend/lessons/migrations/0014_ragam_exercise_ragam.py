from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0013_playbackpart_repeat_count"),
    ]

    operations = [
        migrations.CreateModel(
            name="Ragam",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=120, unique=True)),
                ("arohanam", models.TextField(default="S R G M P D N S+")),
                ("avarohanam", models.TextField(default="S+ N D P M G R S")),
                ("description", models.TextField(blank=True, default="")),
                (
                    "melakarta",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="ragams",
                        to="lessons.melakarta",
                    ),
                ),
            ],
            options={"ordering": ["melakarta__number", "name"]},
        ),
        migrations.AddField(
            model_name="exercise",
            name="ragam",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="exercises",
                to="lessons.ragam",
            ),
        ),
    ]
