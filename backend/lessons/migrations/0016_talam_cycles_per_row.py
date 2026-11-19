from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0015_playbackpart_name"),
    ]

    operations = [
        migrations.AddField(
            model_name="talam",
            name="cycles_per_row",
            field=models.PositiveIntegerField(default=1),
        ),
    ]
