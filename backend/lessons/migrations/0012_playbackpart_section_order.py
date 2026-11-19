from django.db import migrations, models


def copy_part_sections(apps, schema_editor):
    PlaybackPart = apps.get_model("lessons", "ExercisePlaybackPart")
    for part in PlaybackPart.objects.all():
        part.section_order = [part.section_id]
        part.save(update_fields=["section_order"])


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0011_exerciseplaybackpart"),
    ]

    operations = [
        migrations.AddField(
            model_name="exerciseplaybackpart",
            name="section_order",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(copy_part_sections, migrations.RunPython.noop),
    ]
