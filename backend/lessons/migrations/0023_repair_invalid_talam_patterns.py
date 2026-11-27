from django.db import migrations


DEFAULT_BEAT_NUMBERS = ("0", "1", "2", "3", "0", "6", "0", "6")


def repair_talam_patterns(apps, schema_editor):
    Talam = apps.get_model("lessons", "Talam")
    database = schema_editor.connection.alias

    for talam in Talam.objects.using(database).all().iterator():
        changed_fields = []
        if talam.beats < 1:
            talam.beats = 1
            changed_fields.append("beats")

        beat_numbers = [value.strip() for value in talam.beat_numbers.split(",") if value.strip()]
        if len(beat_numbers) != talam.beats or any(
            value not in {"0", "1", "2", "3", "4", "5", "6"} for value in beat_numbers
        ):
            beat_numbers = [
                DEFAULT_BEAT_NUMBERS[index % len(DEFAULT_BEAT_NUMBERS)]
                for index in range(talam.beats)
            ]
            talam.beat_numbers = ",".join(beat_numbers)
            changed_fields.append("beat_numbers")

        try:
            beat_groups = [
                int(value.strip()) for value in talam.beat_groups.split(",") if value.strip()
            ]
        except ValueError:
            beat_groups = []
        if (
            not beat_groups
            or any(group < 1 for group in beat_groups)
            or sum(beat_groups) != talam.beats
        ):
            talam.beat_groups = ",".join(["1"] * talam.beats)
            changed_fields.append("beat_groups")

        if changed_fields:
            talam.save(update_fields=changed_fields)


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0022_fix_melakarta_swara_intervals"),
    ]

    operations = [
        migrations.RunPython(repair_talam_patterns, migrations.RunPython.noop),
    ]
