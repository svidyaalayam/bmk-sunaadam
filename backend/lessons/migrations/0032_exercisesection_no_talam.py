from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("lessons", "0031_exercisesection_ragam"),
    ]

    operations = [
        migrations.AddField(
            model_name="exercisesection",
            name="no_talam",
            field=models.BooleanField(
                default=False,
                help_text="Display each note in its own column and play this section without Talam beats.",
            ),
        ),
    ]
