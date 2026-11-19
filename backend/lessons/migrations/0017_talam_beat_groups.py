from django.db import migrations, models


def initialize_beat_groups(apps, schema_editor):
    Talam = apps.get_model("lessons", "Talam")
    for talam in Talam.objects.all():
        talam.beat_groups = ",".join(["1"] * talam.beats)
        talam.save(update_fields=["beat_groups"])


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0016_talam_cycles_per_row"),
    ]

    operations = [
        migrations.AddField(
            model_name="talam",
            name="beat_groups",
            field=models.CharField(
                default="1",
                help_text="Comma-separated beat counts per displayed column. Must add up to the total beats.",
                max_length=128,
            ),
        ),
        migrations.RunPython(initialize_beat_groups, migrations.RunPython.noop),
    ]
