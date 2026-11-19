from django.core.management.base import BaseCommand

from lessons.models import Exercise, ExerciseSection, Melakarta, Ragam, Session, Talam


MELAKARTA_NAMES = [
    "Kanakangi", "Ratnangi", "Ganamurti", "Vanaspati", "Manavati", "Tanarupi",
    "Senavati", "Hanumatodi", "Dhenuka", "Natakapriya", "Kokilapriya", "Rupavati",
    "Gayakapriya", "Vakulabharanam", "Mayamalavagowla", "Chakravakam", "Suryakantam",
    "Hatakambari", "Jhankaradhwani", "Natabhairavi", "Keeravani", "Kharaharapriya",
    "Gaurimanohari", "Varunapriya", "Mararanjani", "Charukesi", "Sarasangi",
    "Harikambhoji", "Dheerasankarabharanam", "Naganandini", "Yagapriya",
    "Ragavardhini", "Gangeyabhushani", "Vagadheeswari", "Shulini", "Chalanata",
    "Salagam", "Jalarnavam", "Jhalavarali", "Navaneetam", "Pavani", "Raghupriya",
    "Gavambodhi", "Bhavapriya", "Shubhapantuvarali", "Shadvidhamargini", "Suvarnangi",
    "Divyamani", "Dhavalambari", "Namanarayani", "Kamavardhini", "Ramapriya",
    "Gamanashrama", "Viswambhari", "Shamalangi", "Shanmukhapriya", "Simhendramadhyamam",
    "Hemavati", "Dharmavati", "Neetimati", "Kantamani", "Rishabhapriya", "Latangi",
    "Vachaspati", "Mechakalyani", "Chitrambari", "Sucharitra", "Jyotisvarupini",
    "Dhatuvardhani", "Nasikabhushani", "Kosalam", "Rasikapriya",
]

RG_VARIANTS = [(1, 1), (1, 3), (1, 4), (2, 3), (2, 4), (3, 4)]
DN_VARIANTS = [(8, 9), (8, 10), (8, 11), (9, 10), (9, 11), (10, 11)]


def standard_melakarta_intervals(number):
    position = (number - 1) % 6
    r, g = RG_VARIANTS[position]
    d, n = DN_VARIANTS[position]
    m = 5 if number <= 36 else 6
    return {"S": 0, "R": r, "G": g, "M": m, "P": 7, "D": d, "N": n}


def numbered_swaras(intervals):
    variants = {
        "R": {1: "R1", 2: "R2", 3: "R3"},
        "G": {2: "G1", 3: "G2", 4: "G3"},
        "M": {5: "M1", 6: "M2"},
        "D": {8: "D1", 9: "D2", 10: "D3"},
        "N": {9: "N1", 10: "N2", 11: "N3"},
    }
    return {
        swara: variants.get(swara, {}).get(interval, swara)
        for swara, interval in intervals.items()
    }


DEFAULT_LESSONS = [
    {
        "title": "Exercise 1",
        "description": "Simple ascent/descent.",
        "notes": "s r g m p d n S+ S+ n d p m g r s",
        "repeat_to_complete_talam": True,
        "position": 0,
    },
    {
        "title": "Exercise 2",
        "description": "Focus on R and N.",
        "notes": "s r s r s r g m s r g m p d n S+ S+ n S+ n S+ n d p S+ n d p m g r s",
        "repeat_to_complete_talam": True,
        "position": 1,
    },
    {
        "title": "Exercise 3",
        "description": "Focus on G and D.",
        "notes": "s r g s r g s r s r g m p d n s+ s+ n d s+ n d s+ n s+ n d p m g r s",
        "repeat_to_complete_talam": True,
        "position": 2,
    },
    {
        "title": "Exercise 4",
        "description": "Focus on M and P.",
        "notes": "s r g m s r g m p d n s S n d p S n d p m g r s",
        "repeat_to_complete_talam": True,
        "position": 3,
    },
    {
        "title": "Exercise 5",
        "description": "Focus on P and M (dheergam); and R, N.",
        "notes": "s r g m p ; s r s r g m p d n S S n d p m ; S n S n d p m g r s",
        "repeat_to_complete_talam": True,
        "position": 4,
    },
    {
        "title": "Exercise 6",
        "description": "Focus on G and D.",
        "notes": "s r g m p d s r s r g m p d n S S n d p m g s n S n d p m g r s",
        "repeat_to_complete_talam": True,
        "position": 5,
    },
    {
        "title": "Exercise 7",
        "description": "Focus on N and R (dheergam).",
        "notes": "s r g m p d n ; s r g m p d n S S n d p m g r ; S n d p m g r s",
        "repeat_to_complete_talam": True,
        "position": 6,
    },
    {
        "title": "Exercise 8",
        "description": 'Zig zag with focus on "pmgr" and "mpdn".',
        "notes": "s r g m p m g r s r g m p d n S S n d p m p d n S S n d p m g r s",
        "repeat_to_complete_talam": True,
        "position": 7,
    },
    {
        "title": "Exercise 9",
        "description": 'Zig zag with focus on "pmdp" and "mpgm".',
        "notes": "s r g m p m d p s r g m p d n S S n d p m p g m S n d p m g r s",
        "repeat_to_complete_talam": True,
        "position": 8,
    },
    {
        "title": "Exercise 10",
        "description": "Focus on P (dheergam), the region between G and N, and resting on G (nyaasa swaram).",
        "notes": "s r g m p ; g m p ; ; ; p ; ; ; g m g m p d n d p m g m p g m r s",
        "repeat_to_complete_talam": True,
        "position": 9,
    },
    {
        "title": "Exercise 11",
        "description": 'Focus on dheergams at S, N, D and P; patterns "Snd", "Ndp", "Dpm"; the region between G and N; and janta at P.',
        "notes": "S ; n d n ; d p d ; p m p ; p ; g m p d n d p m g m p g m r s",
        "repeat_to_complete_talam": True,
        "position": 10,
    },
    {
        "title": "Exercise 12",
        "description": 'Preview of janta (sphuritam): "SS", "nn", "dd", "pp"; patterns "SSnd", "nndp", "ddpm"; dheergam at "paa"; and the region between G and N.',
        "notes": "S S n d n n d p d d p m p ; p ; g m p d n d p m g m p g m r s",
        "repeat_to_complete_talam": True,
        "position": 11,
    },
    {
        "title": "Exercise 13",
        "description": 'Zigzag patterns "srgr G" and "gmpmP"; dheergam focus on G, P and D; and the region between M and N with emphasis on zigzag and D notes.',
        "notes": "s r g r g ; g m p m p ; d p d ; m p d p d n d p m p d p m g r s",
        "repeat_to_complete_talam": True,
        "position": 12,
    },
    {
        "title": "Exercise 14",
        "description": "Dheergam at P and S; jantas at D and M.",
        "notes": "s r g m p ; p ; d d p ; m m p ; d n S ; S n d p S n d p m g r s",
        "repeat_to_complete_talam": True,
        "position": 13,
    },
]

GEETHAM = {
    "title": "Sri Gananatha",
    "notes": "M P D S+ S+ R+ R+ S+ D P M P R M P D M P D P M G R S",
    "lyrics": "Sri - ga na na tha Sin dhu ra - va rna ka ru na sa ga ra ka ri va da - na",
    "repeat_to_complete_talam": True,
}


class Command(BaseCommand):
    help = "Seed the default Carnatic exercises."

    def handle(self, *args, **options):
        melakartas = {}
        for number, name in enumerate(MELAKARTA_NAMES, start=1):
            intervals = standard_melakarta_intervals(number)
            melakarta, _ = Melakarta.objects.update_or_create(
                number=number,
                defaults={
                    "name": name,
                    "swara_intervals": intervals,
                },
            )
            melakartas[number] = melakarta

        default_melakarta = melakartas[15]
        ragams = {}
        for number, name in enumerate(MELAKARTA_NAMES, start=1):
            numbered = numbered_swaras(melakartas[number].swara_intervals)
            ragams[number], _ = Ragam.objects.update_or_create(
                name=name,
                defaults={
                    "melakarta": melakartas[number],
                    "arohanam": (
                        f"S {numbered['R']} {numbered['G']} {numbered['M']} "
                        f"P {numbered['D']} {numbered['N']} S+"
                    ),
                    "avarohanam": (
                        f"S+ {numbered['N']} {numbered['D']} P {numbered['M']} "
                        f"{numbered['G']} {numbered['R']} S"
                    ),
                    "description": f"{name} based on Melakarta {number}.",
                },
            )
        default_ragam = ragams[15]
        carnatic, _ = Session.objects.get_or_create(
            name="Carnatic",
            parent=None,
            defaults={"position": 0},
        )
        Session.objects.get_or_create(name="Hindustani", parent=None, defaults={"position": 1})
        Session.objects.get_or_create(name="General songs", parent=None, defaults={"position": 2})
        saraliswarams, _ = Session.objects.get_or_create(
            name="Sarali swarams",
            parent=carnatic,
            defaults={"position": 0, "allow_ragam_change": True},
        )
        if not saraliswarams.allow_ragam_change:
            saraliswarams.allow_ragam_change = True
            saraliswarams.save(update_fields=["allow_ragam_change"])

        geethams, _ = Session.objects.get_or_create(
            name="Geethams",
            parent=carnatic,
            defaults={"position": 1, "allow_ragam_change": False},
        )
        adi_talam, _ = Talam.objects.get_or_create(
            name="Adi Talam",
            defaults={"beats": 8, "beat_numbers": "0,1,2,3,0,6,0,6"},
        )
        rupaka_talam, _ = Talam.objects.get_or_create(
            name="Rupaka Talam",
            defaults={"beats": 6, "beat_numbers": "0,6,0,1,2,3"},
        )

        for lesson in DEFAULT_LESSONS:
            exercise, _ = Exercise.objects.update_or_create(
                title=lesson["title"],
                session=saraliswarams,
                defaults={
                    "description": lesson["description"],
                    "notes": lesson["notes"].upper(),
                    "talam": adi_talam,
                    "melakarta": default_melakarta,
                    "ragam": default_ragam,
                    "repeat_to_complete_talam": lesson.get("repeat_to_complete_talam", True),
                    "position": lesson["position"],
                },
            )
            if not ExerciseSection.objects.filter(exercise=exercise).exists():
                ExerciseSection.objects.create(
                    exercise=exercise,
                    title="Main",
                    notes=lesson["notes"].upper(),
                    position=0,
                )
        geetham, _ = Exercise.objects.get_or_create(
            title=GEETHAM["title"],
            session=geethams,
            defaults={
                "notes": GEETHAM["notes"],
                "lyrics": GEETHAM["lyrics"],
                "talam": rupaka_talam,
                "melakarta": default_melakarta,
                "ragam": default_ragam,
                "position": 0,
            },
        )
        if not ExerciseSection.objects.filter(exercise=geetham).exists():
            ExerciseSection.objects.create(
                exercise=geetham,
                title="Main",
                notes=GEETHAM["notes"],
                lyrics=GEETHAM["lyrics"],
                position=0,
            )
        if not geetham.melakarta_id:
            geetham.melakarta = default_melakarta
        if not geetham.ragam_id:
            geetham.ragam = default_ragam
        if not geetham.melakarta_id or not geetham.ragam_id:
            geetham.save(update_fields=["melakarta", "ragam"])
        self.stdout.write(self.style.SUCCESS("Default curriculum checked."))
