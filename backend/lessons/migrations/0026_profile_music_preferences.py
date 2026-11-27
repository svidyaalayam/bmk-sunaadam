from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0025_user_accounts"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="instrument_name",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="default_shruthi",
            field=models.CharField(default="normal-G", max_length=16),
        ),
    ]
