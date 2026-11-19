from django.db import migrations, models
import django.db.models.deletion


def copy_legacy_sections(apps, schema_editor):
    PlaybackStep = apps.get_model("lessons", "ExercisePlaybackStep")
    for step in PlaybackStep.objects.exclude(section_id=None):
        step.sections.add(step.section_id)


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0008_exerciseplaybackstep"),
    ]

    operations = [
        migrations.AlterField(
            model_name="exerciseplaybackstep",
            name="section",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="legacy_playback_steps",
                to="lessons.exercisesection",
            ),
        ),
        migrations.AddField(
            model_name="exerciseplaybackstep",
            name="sections",
            field=models.ManyToManyField(
                blank=True,
                related_name="playback_steps",
                to="lessons.exercisesection",
            ),
        ),
        migrations.RunPython(copy_legacy_sections, migrations.RunPython.noop),
    ]
