from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0005_melakarta_exercise_melakarta"),
    ]

    operations = [
        migrations.AddField(
            model_name="exercise",
            name="description",
            field=models.TextField(blank=True, default=""),
        ),
    ]
