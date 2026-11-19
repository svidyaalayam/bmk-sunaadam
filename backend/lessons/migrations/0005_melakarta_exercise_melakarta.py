from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0004_exercise_lyrics"),
    ]

    operations = [
        migrations.CreateModel(
            name="Melakarta",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("number", models.PositiveSmallIntegerField(unique=True)),
                ("name", models.CharField(max_length=120, unique=True)),
                (
                    "swara_intervals",
                    models.JSONField(
                        default=dict,
                        help_text='JSON semitone map, for example {"S":0,"R":2,"G":4,"M":5,"P":7,"D":9,"N":11}.',
                    ),
                ),
            ],
            options={
                "ordering": ["number"],
                "verbose_name": "Melakarta raga",
                "verbose_name_plural": "Melakarta ragas",
            },
        ),
        migrations.AddField(
            model_name="exercise",
            name="melakarta",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="exercises",
                to="lessons.melakarta",
            ),
        ),
    ]
