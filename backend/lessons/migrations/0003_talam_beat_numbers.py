from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0002_curriculum"),
    ]

    operations = [
        migrations.AddField(
            model_name="talam",
            name="beat_numbers",
            field=models.CharField(
                default="0,1,2,3,0,6,0,6",
                help_text="Comma-separated numbers, one per beat. Allowed values: 0 to 6.",
                max_length=128,
            ),
        ),
    ]
