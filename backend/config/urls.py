from django.contrib import admin
from django.contrib.staticfiles.views import serve
from django.urls import include, path, re_path

admin.site.site_header = "BMK Sunaadam Admin"
admin.site.site_title = "BMK Sunaadam"
admin.site.index_title = "BMK Sunaadam Administration"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("lessons.urls")),
    re_path(r"^static/(?P<path>.*)$", serve, {"insecure": True}),
]
