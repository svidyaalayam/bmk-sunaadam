from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0026_profile_music_preferences"),
    ]

    operations = [
        migrations.AddField(
            model_name="practicerecording",
            name="listen_count",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
