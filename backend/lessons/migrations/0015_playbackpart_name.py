from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0014_ragam_exercise_ragam"),
    ]

    operations = [
        migrations.AddField(
            model_name="exerciseplaybackpart",
            name="name",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
    ]
