from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("lessons", "0030_practicerecording_teacher_rating"),
    ]

    operations = [
        migrations.AddField(
            model_name="exercisesection",
            name="ragam",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="exercise_sections",
                to="lessons.ragam",
            ),
        ),
    ]
