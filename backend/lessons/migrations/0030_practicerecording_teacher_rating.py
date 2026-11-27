from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("lessons", "0029_teacherrecordingcomment"),
    ]

    operations = [
        migrations.AddField(
            model_name="practicerecording",
            name="teacher_rating",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
    ]
