from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0012_playbackpart_section_order"),
    ]

    operations = [
        migrations.AddField(
            model_name="exerciseplaybackpart",
            name="repeat_count",
            field=models.PositiveSmallIntegerField(default=1),
        ),
    ]
