from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0003_talam_beat_numbers"),
    ]

    operations = [
        migrations.AddField(
            model_name="exercise",
            name="lyrics",
            field=models.TextField(blank=True, default=""),
        ),
    ]
