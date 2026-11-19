from django.urls import path

from .views import curriculum, lessons

urlpatterns = [
    path("curriculum/", curriculum, name="curriculum"),
    path("lessons/", lessons, name="lessons"),
]
