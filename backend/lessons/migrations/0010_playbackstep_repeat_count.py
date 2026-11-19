from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0009_playbackstep_sections"),
    ]

    operations = [
        migrations.AddField(
            model_name="exerciseplaybackstep",
            name="repeat_count",
            field=models.PositiveSmallIntegerField(default=1),
        ),
    ]
